# Questions

- A question that a session asks appears above the composer: a step of omp's `ask` tool, or a dialog from an extension (a select, a yes or no confirm, a one-line input, or a text editor).
  Click an option or press its number to answer.
  A number key outside a text field answers the focused pane's question only, so with split panes it never reaches another pane's question.
  Type into a text field and press Enter (Cmd+Enter or Ctrl+Enter in a multi-line field), or click **Send**.
  **Dismiss** or Esc cancels the question, which omp treats like Esc in its terminal.
  The session continues its turn with your answer.
  Questions that wait in a queue show their count next to the first one, and a question with a timeout shows the time at which omp takes its default answer.
- In a session that the dashboard started, an `ask` shows one question at a time, with an **Other** row that opens a text field.
  A single-select pick moves to the next question; a multi-select question checks and unchecks its rows, then moves on with **Next**.
  **Back** returns to the previous question, and Esc in the **Other** field returns to the rows.
  The last question sends every answer at once.
- In a terminal session, omp asks one step at a time, as in its terminal.
  Picking `Other (type your own)` brings a text field next.
  In a multi-select question, each pick comes back as a new step with the checked options highlighted, and a final row (`Done selecting` or `Next →`) submits the selection.
