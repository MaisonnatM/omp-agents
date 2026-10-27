# Socket requests

A page tags a message it waits on with an `ack`, counted per page load, and the server answers it with `done`, carrying the error its handler threw or `null`.
`request` in `web/use-dashboard.ts` sends that way prompts, answers to questions, starts and **Resume all**, interrupts, ends, edited prompts, model, thinking, and fast switches, subagent cancels, a routine's **Run now**, and each change to the scheduled sends.
A model switch's `done` comes once omp switched, or refused, and the session read its state again; the composer's picker waits on it, and a roster row's `switching` only tells other pages that a switch runs.
A message the page does not tag, such as a pin, a todo change, or a queued row's **Send now**, is dropped when the socket is down, as before.

A socket can close after the server got a request and before its answer reached the page, and the page cannot tell that from a request the server never got, so it may not simply send it again: a prompt would reach the session twice.
So the page picks an id once per load, `crypto.randomUUID()`, and opens `/ws?page=<id>`, and `RequestLedger` in `src/server/request-ledger.ts` keeps each page's requests by `ack` across its sockets.
A request runs once, and its replies to the page that sent it (`withdrawn`, `started`, `resumed-all`) and its `done` are recorded and sent to whichever socket the page has open at the time.
Each socket the page opens sends `resume` after `watch`, with every tagged message the page still waits on.
The ledger sends the recorded replies of each request it ran, and its `done` once settled; it runs a request it never got; and it forgets every request the page no longer lists.
A reply for a live session goes only to a socket that shows it, which a resume after `watch` already knows.
Each tagged message also carries `floor`, the lowest `ack` the page still waits on, and the ledger forgets the requests below it.
The page's `activity` batches wait on `done` too, so a batch leaves the page's outbox only once the server holding `server.lock` stored it, another server dropped it, or the server answered an error, which drops it so it cannot hold back the batches after it (see [Activity](activity.md)).

The ledger first hears of a page at its `resume`, which then lists only requests the page sent before this server knew it: to a server that has since restarted, or to this one more than an hour ago, since the ledger forgets a page an hour after its last socket closed.
Each of them gets `done` with the error `FORGOTTEN`, "The server restarted or lost track of this page before it answered. Check whether it took effect.", and the ledger records that answer, so a later resume gets it again and nothing runs.
A tagged message from a page the ledger does not know yet is logged and dropped, which the page never sends, since every socket sends `resume` first.
Replies and `done` go to the page's current socket; `Peer.socket`, the socket a message came on, is only for `watch`, which sets that socket's views.
A request the page makes while disconnected rejects at once with "Not connected to the server.", and one it made before keeps waiting across the reconnect, with no time limit.
A prompt that fails comes back to the composer with its files and a note, and a failed answer lets the question card take another.
Prompt preparation errors and `PromptRefused` both reject the request.
An existing session notice is not repeated by the socket handler.
A handler's error goes to the server's log once, with its message type, on the run that threw.
A page loaded before page ids tags its requests with no `floor`, so the server drops them until the page reloads.

`ListRegistry` in `src/server/list-registry.ts` is authoritative for the whole-list snapshots a socket receives.
`Dashboard` registers each typed message builder once, beside its store's edit function when it has synchronous edits.
`Broadcasts.open` iterates these registrations, so a new list needs no separate opening-snapshot or push method.
`Broadcasts.pushList(kind)` uses that same builder and suppresses an identical whole-list message; roster and past messages still send their row-level deltas.
Socket edits, workspace HTTP edits, and todo inbox changes go through the registry's typed `apply`.
An edit that changes the list publishes it to every listener; one that changes nothing instead resends the authoritative snapshot to its requesting peer, if there is one.
Routine and scheduled runner actions and asynchronous notice actions remain separate, publishing their list through `pushList` when they change it.
