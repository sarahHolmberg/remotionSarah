GRID PLAYER → COMIC SERVER: SENDING A VIDEO + TRANSCRIPT
=========================================================

PURPOSE
For each finished dance video, the grid player sends ONE request with the video file and its text transcript.
The server stores them and puts the task on the Parrot site (/parrot/), where a person turns the transcript into the
caption script. As soon as the script is sent, the server does the rest by itself: renders the comic version
(mascot style), schedules an Instagram Reel (whole video) and Story (first 10 seconds) in the next free posting slot
(17:00 or 20:00, Europe/Stockholm), posts them, and deletes the videos afterwards.

------------------------------------------------------------------------------
1. THE REQUEST
------------------------------------------------------------------------------
Method:   POST
URL:      https://remotion-render-15508612518.us-central1.run.app/api/tasks
Header:   Authorization: Bearer <INBOX_KEY>
          (the same secret key already used for sending links; keep it on the grid player's SERVER side only,
          in an environment variable or secret store, never in browser/front-end code)
Body:     multipart/form-data (a standard form upload with a file). Let the HTTP library set the Content-Type
          header with its boundary; do not set it by hand.

Form fields (names are exact and case-sensitive):

  taskId      REQUIRED  text
              The grid player's own unique ID for this video. Allowed: A-Z a-z 0-9 "-" "_", length 1 to 64.
              Unique per video, and the SAME on every retry of that video: the server recognises repeats and
              never processes or posts a video twice.

  transcript  REQUIRED  text (UTF-8), 1 to 50,000 characters
              The spoken caption description, as transcribed (the text that used to be pasted into the AI
              together with the prompt). Send it as it comes out of the transcriber; Parrot adds the prompt.
              It should contain the dancer's name and, when known, their Instagram username
              (e.g. "username lena underscore xr"), plus the caption text if there is one ("Caption, ...").

  video       REQUIRED  file
              The original MP4, unchanged (no re-encoding or compression; it is stored byte for byte).
              Part content type video/mp4, filename ending in .mp4. Maximum 13 MB = 13,631,488 bytes.
              Must be a playable video (H.264 or H.265, as phones and editors produce).

Allow up to 120 seconds for the response (a cold server start plus the upload). The server answers as soon as it
has checked and stored everything.

------------------------------------------------------------------------------
2. THE RESPONSE
------------------------------------------------------------------------------
Every response body is JSON. Decide by "code"; "message" is a human-readable explanation to show or log.

  HTTP 202  {"ok": true, "code": "ACCEPTED", "taskId": "...", "status": "needs_script"}
            Stored; it now waits on Parrot for its script. Nothing more to do: mark the video as sent.

  HTTP 200  {"ok": true, "code": "DUPLICATE", "taskId": "...", "status": "<current status>"}
            This taskId was accepted before (e.g. a retry after a dropped connection). Nothing was done twice.
            Treat exactly like ACCEPTED.

  HTTP 401  code "WRONG_KEY"         Key missing or wrong. Configuration problem: do not retry; alert the developer.
  HTTP 400  code "BAD_REQUEST"       A field is missing or invalid (taskId, transcript, video), or the body is not
                                     multipart/form-data. Do not retry the same request; fix the sending code.
  HTTP 400  code "VIDEO_UNREADABLE"  The file is not a playable MP4 video. Do not retry the same file.
  HTTP 413  code "VIDEO_TOO_BIG"     Over 13,631,488 bytes. Do not retry the same file.
  HTTP 507  code "STORAGE_FULL"      Accepting it would take the server's storage over its free limit.
                                     Extra fields: "usedBytes", "limitBytes", "incomingBytes".
                                     Tell the user "the server's storage is full, try again later"; space frees up
                                     as videos get posted. Retrying every few hours is fine.
  HTTP 409  code "SLOTS_FULL"        Every posting slot for the next 25 days is taken. Retry the next day.
  HTTP 503  code "NOT_READY"         The server is missing a setting (INBOX_KEY or Instagram). Alert the developer;
                                     retrying later is fine.
  Any other 5xx, a timeout, or no response
            Temporary trouble. RETRY with the SAME taskId: after 30 s, 2 min, 10 min, then every 30 min
            (up to 24 hours). The taskId makes retries safe.

------------------------------------------------------------------------------
3. CHECKING THE STATUS (OPTIONAL)
------------------------------------------------------------------------------
GET https://remotion-render-15508612518.us-central1.run.app/api/tasks/<taskId>
Header: Authorization: Bearer <INBOX_KEY>

HTTP 200 {"ok": true, "taskId": "...", "status": "...", ...}
  "needs_script"  waiting on Parrot for a person to make the script
  "queued"        script is in, waiting to be rendered
  "making"        the comic video is being rendered
  "scheduled"     Reel + Story are scheduled; extra field "publishAt" (ISO 8601, UTC)
  "posted"        both are posted; extra field "permalink" (the Reel), when available
  "failed"        something went wrong after the script came in; extra field "error". It shows in the comic
                  editor with a Retry button.
HTTP 404 code "NOT_FOUND" (unknown taskId).   HTTP 401 code "WRONG_KEY".
Polling is optional; at most once every 5 minutes per task, stop at "posted" or "failed".

------------------------------------------------------------------------------
4. WHAT THE GRID PLAYER SHOULD KEEP PER VIDEO
------------------------------------------------------------------------------
- taskId (made once, reused on every retry)
- send state: not sent / sent (ACCEPTED, DUPLICATE) / waiting (STORAGE_FULL, SLOTS_FULL: retry later)
  / needs fixing (BAD_REQUEST, VIDEO_UNREADABLE, VIDEO_TOO_BIG) / config error (WRONG_KEY, NOT_READY)
- the last "message", to show the user

------------------------------------------------------------------------------
5. GOOD TO KNOW
------------------------------------------------------------------------------
- 2 posts per day (17:00 and 20:00 Stockholm). More than 2 videos a day builds a queue; fine up to 25 days ahead.
- One video = one Reel + one Story (first 10 seconds), at the same time.
- The dancer (the script's "username") is always tagged; if Instagram refuses the username, the post still goes out
  without the tag, and this is noted in the editor.
- Videos are deleted from the server once the posts are scheduled/posted.
