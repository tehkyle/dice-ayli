const fs = require('fs');

// TLS credentials for the camera-facing HTTPS listener. getUserMedia requires a
// secure context, so operator phones must load /camera over https no matter what.
//
// Production (own router): point cameraCertPath/cameraKeyPath in config.json at a
// real, publicly-trusted cert (e.g. issued via acme.sh/certbot using a DNS-01
// challenge for a domain you own), and set cameraHostname to that domain with the
// router's DNS overridden to resolve it to this machine's LAN IP. Phones get no
// browser warning at all.
//
// Fallback (ad-hoc network, no domain set up): a self-signed cert is generated
// fresh on every server start, covering the detected LAN IP. Phones will see a
// one-time "connection isn't private" warning the first time they load /camera.
async function getCameraCredentials(config, lanIp) {
  if (
    config.cameraCertPath && config.cameraKeyPath &&
    fs.existsSync(config.cameraCertPath) && fs.existsSync(config.cameraKeyPath)
  ) {
    return {
      cert: fs.readFileSync(config.cameraCertPath, 'utf8'),
      key:  fs.readFileSync(config.cameraKeyPath, 'utf8'),
    };
  }

  const selfsigned = require('selfsigned');
  const notBeforeDate = new Date();
  const notAfterDate  = new Date(notBeforeDate);
  notAfterDate.setFullYear(notAfterDate.getFullYear() + 2);

  const pems = await selfsigned.generate([{ name: 'commonName', value: lanIp }], {
    keySize: 2048,
    algorithm: 'sha256',
    notBeforeDate,
    notAfterDate,
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: lanIp },
          { type: 7, ip: '127.0.0.1' },
        ],
      },
    ],
  });

  return { cert: pems.cert, key: pems.private };
}

module.exports = { getCameraCredentials };
