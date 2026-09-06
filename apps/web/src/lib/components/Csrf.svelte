<script lang="ts">
/** Hidden double-submit field; every form posts it and every action verifies it (A-10). */
let { token }: { token: string } = $props();
</script>

<input type="hidden" name="_csrf" value={token} />
