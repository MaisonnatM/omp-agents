# Providers

- **Providers** is a section of [Settings](settings.md), at `#settings/providers`: a row for each model provider that omp's `/login` offers, such as Anthropic, ChatGPT (Codex), GitHub Copilot, OpenRouter, or Ollama, with the provider's logo, or its initial when the dashboard has no logo for it.
  **Connected** lists the providers omp holds a credential for, and **Available** lists the rest, with **Search** to filter them by name or id.
  The section reads omp's credentials every minute while it is open, so a `/login` from a terminal shows there too, and **Refresh** reads them at once.
- **Connect** runs the provider's `/login` flow on the dashboard's server and saves the credential in omp's credential store, so every new omp session can use the provider's models.
  A provider with more than one way to sign in, such as ChatGPT's device-code sign-in or Z.AI's GLM Coding Plan, offers the others in its **⋯** menu.
  A sign-in that needs your browser shows the provider's instructions and **Open sign-in page**, which opens the provider's page in a new tab; a device-code sign-in shows the code to enter there.
  When the provider asks a question, such as an API key or the authorization code from its page, a field below the instructions takes the answer, masked when the provider marks it secret, and **Continue** sends it.
  For many providers omp checks an API key against the provider before it saves it, so a wrong key fails at once.
  When the browser cannot reach the dashboard's computer, paste the final redirect address or the authorization code into the field instead.
  The row says **Signing in** until the sign-in ends, and **Cancel** abandons it.
  It then says **Signed in** with the account, or why the sign-in failed, until you choose **Dismiss**.
  One sign-in runs at a time: starting another abandons the first, and a sign-in not finished within 5 minutes fails.
- A connected row lists each stored account or key, and its **⋯** menu offers **Add account** to sign in to another one, as `/login` does for a provider you already use.
  **Sign out** asks first, then removes that one credential, as `/logout` does.
  A provider whose key omp reads from an environment variable, with nothing stored, shows as connected with the variable's name; unset the variable to sign out, as Settings cannot remove it.
  A sign-in saved here takes precedence over that variable.
- After a sign-in or sign-out, omp refreshes the provider's model list, so **Models** and new sessions offer the models the credential unlocks.
  Providers that omp extensions add are not listed, as the dashboard's server does not load extensions.
