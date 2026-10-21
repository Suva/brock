<!--
  A node's priority, 1 to 5, as a small numbered circle: warm and strong for
  what comes first, grey for 4 and 5, which come after what has none.
-->
<script lang="ts">
  let { priority }: { priority: number } = $props();

  const COLOURS: Record<number, string> = {
    1: "#e03131",
    2: "#f08c00",
    3: "#1c7ed6",
    4: "#868e96",
    5: "#adb5bd",
  };
</script>

<span class="badge" style:--colour={COLOURS[priority]} title="Priority {priority} (⌘{priority})" aria-label="Priority {priority}"
  >{priority}</span
>

<style>
  .badge {
    flex: none;
    display: inline-grid;
    place-items: center;
    width: 1.25em;
    height: 1.25em;
    border-radius: 50%;
    background: var(--colour);
    color: #fff;
    font: 700 0.72em/1 system-ui, sans-serif;
    font-variant-numeric: tabular-nums;
    vertical-align: 0.1em;
  }
</style>
