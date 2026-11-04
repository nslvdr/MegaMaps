<script lang="ts">
  import { appDetails, helpUrl, type Topic } from "./help";
  import Row from "./kit/Row.svelte";
  // A way to reach out on GitHub; it leaves the app, so it ends on an external link.
  let { topic, icon, tone, label, hint }: { topic: Topic; icon: string; tone: string; label: string; hint: string } = $props();
</script>

<Row tag="a" href={helpUrl(topic, topic === "problem" ? appDetails() : "")} external {icon} {tone} {label} {hint} data-help={topic} />
