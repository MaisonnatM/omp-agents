# Memory

- The **Memory** tab in the sidebar, a `#memory` address, or **Go to memory** in the command menu shows what omp and your projects remember, and your bookmarks, in place of the panes.
  The header's **omp memory**, **Project memory**, and **Bookmarks** tabs switch between the three.

## omp memory

- The **omp memory** tab is the same as Settings › omp memory, for the sidebar's workspace; see [Settings](settings.md).
  A link to a memory file opens Settings › Files.

## Project memory

- The **Project memory** tab shows what agents recorded with their `project_memory` tool, one repository at a time: each memory's kind, slug, line, when it changed, and which session changed it.
- The repository picker lists every workspace's git repository with how many memories it holds.
  The page opens on the repository that holds the sidebar's workspace, and `#memory/project?repo=<path>` opens another.
- **Filter** narrows the list to memories whose slug, line, or body holds every word you type.
- Click a memory to open it beside the list, change its kind, line, or body, and click **Save**, or press ⌘ Enter in the body.
  The arrows above it open the previous and next memory, and **×** closes it.
- **New memory** asks for a slug, a kind, a line, and a body, and **Add memory** records it.
- **Delete**, clicked twice, removes the open memory.
- Each change is recorded in the repository's `refs/omp/memory` as made by this page, and a change the memory refuses, such as a slug already taken, shows why under the form.

## Bookmarks

- The **Bookmarks** tab lists your Zen bookmarks and your x.com bookmarks, newest first.
  A Zen bookmark shows its folder and address, and an x.com one its author and post.
  Click a bookmark to open it in your browser.
- **Search** keeps the bookmarks whose title, address, folder, author, or post holds every word you type, and `#memory/bookmarks?q=<words>` opens a search.
  **All**, **Zen**, and **x.com** narrow the list to one source.
- The line under the search says when the x.com bookmarks were last read, or why they could not be.
  They are read through your x.com sign-in in Zen, so sign in to x.com in Zen first.
  **Sync x.com** reads them again.
- Every agent's `bookmarks` tool searches the same bookmarks, so you can ask a session for the article you saved about a subject.
