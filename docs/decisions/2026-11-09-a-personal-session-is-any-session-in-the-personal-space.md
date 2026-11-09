---
status: accepted
date: 2026-11-09
decision-makers: Maxence, agent
supersedes: 2026-11-03-a-personal-session-is-one-that-runs-in-the-personal-directory
---

# A personal session is any session in the Personal space

In the context of the Personal space, which now holds repositories as well as the personal directory, facing personal memory, `remember`, and the `sport` tool that reach only sessions in the personal directory, we chose to give all three to every session whose workspace is in the Personal space.
We rejected keeping them to the personal directory, which would leave a session in a personal repository not knowing the user, and giving memory to the whole space but the `sport` tool to the directory only, which splits one idea in two.
The cwd still decides, through its workspace's space, so resume, fork, and reattach need no new field, accepting the personal memory in every Personal turn's prompt, about 1.5 KB today and capped at 16 KiB.
