<script lang="ts">
  import { t } from "../i18n";
  import { icons } from "./icons";
  import HelpLink from "./HelpLink.svelte";
  import Rows from "./kit/Rows.svelte";
</script>

<!-- The three ways to reach out, in Settings. -->
<Rows class="mt-0!">
  <HelpLink topic="question" icon={icons.question} tone="var(--neon-view)" label={t("Ask a question")} hint={t("Others may have asked already")} />
  <HelpLink topic="idea" icon={icons.idea} tone="var(--neon-add)" label={t("Suggest a feature")} hint={t("Vote on ideas or add yours")} />
  <HelpLink topic="problem" icon={icons.bug} tone="var(--neon-lock)" label={t("Report a problem")} hint={t("Your app version is included")} />
</Rows>
