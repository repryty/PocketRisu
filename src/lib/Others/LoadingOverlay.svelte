<script lang="ts">
    import { LoaderCircleIcon } from "@lucide/svelte";
    import { loadingOverlayStore } from "src/ts/stores.svelte";
    import { language } from "src/lang";
</script>

{#if $loadingOverlayStore.active}
    <div class="fixed top-4 right-4 z-[60] max-w-[min(22rem,calc(100vw-2rem))] pointer-events-none" role="status" aria-live="polite">
        <div class="pointer-events-auto flex items-center gap-3 rounded-2xl border border-darkborderc/70 bg-bgcolor/95 px-3.5 py-3 shadow-xl backdrop-blur-md">
            <LoaderCircleIcon size={18} class="shrink-0 animate-spin text-borderc" />
            <div class="min-w-0 flex-1">
                <p class="truncate text-sm text-textcolor">{$loadingOverlayStore.text || language.loadingChatData || 'Loading...'}</p>
                <p class="mt-0.5 text-xs text-textcolor2">{language.loadingChatData}</p>
            </div>
            {#if $loadingOverlayStore.onCancel}
                <button
                    class="shrink-0 rounded-lg border border-darkborderc px-2.5 py-1.5 text-xs text-textcolor2 transition-colors hover:bg-selected hover:text-textcolor cursor-pointer"
                    onclick={() => $loadingOverlayStore.onCancel?.()}
                >{language.cancel}</button>
            {/if}
        </div>
    </div>
{/if}
