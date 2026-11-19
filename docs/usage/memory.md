# Memory

- The **Memory** tab in the sidebar, a `#memory` address, or **Go to memory** in the command menu shows what omp and your projects remember, and your bookmarks, in place of the panes.
  The header's **omp memory**, **Project memory**, and **Bookmarks** tabs switch between the three.

## omp memory

- The **omp memory** tab is the same as Settings › omp memory, for the sidebar's workspace; see [Settings](settings.md).
  A link to a memory file opens Settings › Files.

## Project memory

- The **Project memory** tab shows what agents recorded with their `project_memory` tool, one repository at a time, in a table of each memory's kind, slug, line, when it changed, and which session changed it.
- With **All** picked, the table groups the memories under a header per kind with its count, which stays at the top as you scroll.
  The **Decision**, **Fact**, and **Lesson** chips, each with its count, show only that kind.
- The repository picker lists every workspace's git repository with how many memories it holds.
  The page opens on the repository that holds the sidebar's workspace, and `#memory/project?repo=<path>` opens another.
- **Filter** narrows the table to memories whose slug, line, or body holds every word you type.
- Click a row to open the memory in a drawer over the table, change its kind, line, or body, and click **Save**, or press ⌘ Enter in the body.
  The arrows at the drawer's top open the previous and next row, and **×**, Escape, or a click beside the drawer closes it.
- **New memory** asks for a slug, a kind, a line, and a body, and **Add memory** records it.
- **Delete**, clicked twice, removes the open memory.
- Each change is recorded in the repository's `refs/omp/memory` as made by this page, and a change the memory refuses, such as a slug already taken, shows why under the form.

## Bookmarks

- The **Bookmarks** tab lists your Zen bookmarks and your x.com bookmarks, newest first, in three columns: the folders, the list, and the open bookmark.
- The folder tree on the left holds **All bookmarks**, **x.com**, **Zen**, and Zen's folders, each with how many bookmarks it holds.
  Click one to list only its bookmarks, a folder's subfolders included.
- The list shows each bookmark's site icon, title, date, and a post's author and start or a page's site.
  When it holds more than one folder, a header with its count starts each folder, and x.com posts come last.
- Click a bookmark, or move with the up and down arrows, to read it on the right: a post's whole text with its links, or a page's address, folder, and date.
  The arrows at the reader's top open the previous and next bookmark, and **×** closes it.
  **Open on x.com** or **Open page** opens it in your browser.
- **Search** keeps the bookmarks whose title, address, folder, author, or post holds every word you type, and `#memory/bookmarks?q=<words>` opens a search.
  **All**, **Zen**, and **x.com** narrow the list and the tree to one source.
- The right of the toolbar says when the x.com bookmarks were last read, or why they could not be.
  They are read through your x.com sign-in in Zen, so sign in to x.com in Zen first.
  **Sync x.com** reads them again.
- Every agent's `bookmarks` tool searches the same bookmarks, so you can ask a session for the article you saved about a subject.
