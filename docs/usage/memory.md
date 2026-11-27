# Memory

- The **Memory** tab in the sidebar, a `#memory` address, or **Go to memory** in the command menu shows what your projects remember, and your bookmarks, in place of the panes.
  The header's **Project memory** and **Bookmarks** tabs switch between the two; omp's own memory lives in Settings › omp memory, see [Settings](settings.md).

## Project memory

- The **Project memory** tab shows what agents recorded with their `project_memory` tool, one repository at a time, in a table of each memory's slug, line, when it changed, and which session changed it.
  On a narrow page the table drops the session, then the slug, so the line keeps its room, and hovering a cut line shows all of it.
- With **All** picked, the table groups the memories under a header per kind with its count, which stays at the top as you scroll.
  The **Decision**, **Fact**, and **Lesson** chips, each with its count, show only that kind.
- The repository picker lists **All projects**, then every workspace's git repository, each with how many memories it holds.
  The page opens on **All projects**, every repository's memories in one table with a **Project** column, and `#memory?repo=<path>` opens one repository; New memory shows only with one repository picked.
- **Search** narrows the table to memories whose slug, line, or body holds every word you type.
- Click a row, or move to it with the up and down arrows or `j` and `k` and press Enter, to open the memory beside the table, as Bookmarks opens a bookmark; drag the line between them to size the table.
  Change its kind, line, or body, and click **Save**, or press Enter in the line or ⌘ Enter in the body.
  The arrows at the panel's top, or the same keys, open the previous and next row, and **×** or Escape closes it.
- Closing the panel or opening another memory keeps what you typed: the row says **Unsaved**, and opening it again brings your change back.
  **Revert** drops it.
- **New memory** asks for a slug, a kind, a line, and a body, and **Add memory** records it.
- **Delete**, clicked twice, removes the open memory.
- Each change is recorded in the repository's `refs/omp/memory` as made by this page, and a change the memory refuses, such as a slug already taken, shows why under the form.
- With one repository picked, as on a Workspace's Memory tab, **Glossary** shows when the repository has a `GLOSSARY.md`, and opens it beside the table, rendered; click it again, or **×** or Escape, to close it.

## Bookmarks

- The **Bookmarks** tab lists your Zen bookmarks and your x.com bookmarks, newest first, in three columns: the folders, the list, and the open bookmark.
  Nothing opens until you pick a bookmark.
- The folder tree on the left holds **All bookmarks**, **x.com**, **Zen**, and Zen's folders, each with how many bookmarks the search keeps there.
  Click one to list only its bookmarks, a folder's subfolders included.
  On a narrow window the tree folds into a picker beside the search.
- The list shows each bookmark's site icon, title, date, and a post's author and start or a page's site.
  When it holds more than one folder, a header with its count starts each folder, and x.com posts come last.
- Click a bookmark, or move to it with the up and down arrows or `j` and `k` and press Enter, to read it on the right: a post's whole text with its links, or a page's address and date.
  The arrows at the reader's top, or the same keys, open the previous and next bookmark, and **×** or Escape closes it.
  **Open on x.com** or **Open page** opens it in your browser.
- A post's photos, videos, and GIFs show under its text in the reader, and the list shows a small preview of the first one.
  Click a photo to open it full size in a new tab; they load straight from X's servers.
- A post in another language shows in English, in the list and in the reader, which says which language it was translated from; **Show original** shows the post as written.
  Each sync sends the text of the posts not yet translated to Google Translate, so that text leaves your machine for Google.
- **Search** keeps the bookmarks whose title, address, folder, author, post, or a post's English holds every word you type, and `#memory/bookmarks?q=<words>` opens a search.
- The right of the toolbar says when the x.com bookmarks were last read, or why they could not be.
  They are read through your x.com sign-in in Zen, so sign in to x.com in Zen first.
  **Sync x.com** reads them again.
- Every agent's `bookmarks` tool searches the same bookmarks, so you can ask a session for the article you saved about a subject.
