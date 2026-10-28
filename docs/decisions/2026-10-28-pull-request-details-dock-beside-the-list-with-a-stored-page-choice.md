---
status: accepted
date: 2026-10-28
decision-makers: agent
---

# Pull request details dock beside the list, with a stored choice to show them as a page

In the context of the Pull requests page's list view, facing a row click that replaced the table with the details on a page of their own, we chose to dock the details beside the table as the board already did, with **Open as a page** setting a stored placement of `beside` or `page` that the page and the sidebar both read, over dropping the page and over carrying the placement in the address, to keep the table in view while a wide page stays one click away for the **Code** tab, accepting that a chosen page sticks for the next pull request until **Back to Pull requests** docks the details again.

## Options considered

- Drop the page and always dock: the least code, but the **Code** tab's file tree and diffs get at most 45% of the width.
- Carry the placement in the hash: survives a shared link, but every link that names a pull request, from rows, stacks, sessions, and ↓ and ↑, would have to carry it or fall back to docked.
- A stored placement, as the List and Board view is stored: links stay as they are, and `pullRequestsPageShows` reads one more value.

## Revisit when

Users ask for the docked column to be resizable, which could replace the page altogether.
