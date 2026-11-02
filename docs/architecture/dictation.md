# Dictation

The composer's microphone turns speech into text at the saved selection, and nothing sends it.
It reuses omp's own dictation, so the settings, the models, and the recorder are omp's.

## Where it records

The server records, not the page.
`startDictation` in `src/omp/dictation.ts` builds omp's `RpcDictationBridge` from `modes/rpc/rpc-dictation.ts` with no session and a factory for omp's `STTController`, the recorder omp's terminal uses.
The bridge reads the directory's `stt` settings, starts the recorder, and reports `listening`, `preview`, `transcribing`, and `end` events, which `src/server/dictation.ts` sends the page as `dictation` messages under the page's capture id.
The microphone is the one of the computer that runs the dashboard, which in the desktop app is the user's own.

## One capture

`Dictation` in `src/server/dictation.ts` holds one capture for the whole server, by the socket that started it.
A second `dictation-start` while one runs ends at once with the error that dictation is busy.
`dictation-stop` ends the recording and keeps what it heard, `dictation-discard` closes the microphone and keeps nothing, and both act only for the owning socket and capture id.
A socket's close disposes its capture, and the page marks it failed with "Lost the connection to the server.", keeping its last preview for **Use preview**.

## The page

`web/dictation.ts` holds the page's one capture: starting, listening, or transcribing for one draft, or ended with no speech or an error.
Before each start, `useDictation` in `web/components/composer-dictation.tsx` reads `GET /api/dictation/settings` for the composer's directory; when dictation is off it opens the setup popover instead, whose **Enable dictation** sends `PUT /api/dictation/settings`.
The composer's selection is saved as the microphone is pressed, and the ended text replaces that range through `replaceInComposer` in `web/composer-drafts.ts`, in the mounted composer or in the kept draft.
While its capture runs, the composer is read-only and does not send, so the saved range still names the same text when the result lands.
Leaving the composer stops its capture and keeps the result.
A composer that keeps no draft, such as a scheduled start's, shows no microphone.

## The desktop app

The packaged app declares `NSMicrophoneUsageDescription` and the hardened runtime's `com.apple.security.device.audio-input` entitlement, so macOS can ask for the microphone in the app's name; see [Desktop shell](desktop-shell.md).
