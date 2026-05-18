-- ═══════════════════════════════════════════════════════════════════
--  Act Scene Randomiser — QLab Script Cue
--  Duplicate and adjust the three config values for acts 3 and 4.
--  If the SCENES_CUE notes begin with "ORDERED:", scenes are played
--  front-to-back instead of at random (set by Showrunner rig mode).
-- ═══════════════════════════════════════════════════════════════════

-- ── Config ──────────────────────────────────────────────────────────
set SCENES_CUE   to "A2_SCENES"  -- memo cue holding available scene IDs
set START_CUE    to "ACT_2_GO"   -- start cue whose target gets updated
set FALLBACK_CUE to "2FINALE"    -- target when no scenes remain
-- ────────────────────────────────────────────────────────────────────

tell application "QLab"
	tell front workspace

		set scenesCue  to first cue whose q number is SCENES_CUE
		set startCue   to first cue whose q number is START_CUE
		set fallbackCue to first cue whose q number is FALLBACK_CUE

		-- Detect fixed-order mode
		set rawNotes to notes of scenesCue as text
		set isOrdered to rawNotes starts with "ORDERED:"
		if isOrdered then set rawNotes to text 9 thru -1 of rawNotes

		set AppleScript's text item delimiters to ","
		set rawItems to text items of rawNotes
		set AppleScript's text item delimiters to ""

		set sceneList to {}
		repeat with rawId in rawItems
			set t to rawId as text
			repeat while t starts with " " or t starts with tab
				set t to text 2 thru -1 of t
			end repeat
			repeat while t ends with " " or t ends with tab
				set t to text 1 thru -2 of t
			end repeat
			if t is not "" then set end of sceneList to t
		end repeat

		-- No scenes left — point to fallback and exit
		if (count of sceneList) is 0 then
			set cue target of startCue to fallbackCue
			return
		end if

		-- Fixed order: take first; randomised: pick at random
		if isOrdered then
			set pickedScene to item 1 of sceneList
		else
			set pickedScene to item (random number from 1 to (count of sceneList)) of sceneList
		end if

		set cue target of startCue to (first cue whose q number is pickedScene)

		set remaining to {}
		repeat with sceneId in sceneList
			if (sceneId as text) is not pickedScene then set end of remaining to (sceneId as text)
		end repeat

		set AppleScript's text item delimiters to ","
		set newNotes to (remaining as text)
		if isOrdered then set newNotes to "ORDERED:" & newNotes
		set notes of scenesCue to newNotes
		set AppleScript's text item delimiters to ""

	end tell
end tell
