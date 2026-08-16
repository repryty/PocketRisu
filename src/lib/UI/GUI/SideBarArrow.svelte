<script lang="ts">
    import { ArrowLeft, ArrowRight } from "@lucide/svelte";
    import { DynamicGUI, MobileGUI, sideBarClosing, sideBarStore } from "src/ts/stores.svelte";

</script>

{#if !$MobileGUI}
    <button
        type="button"
        aria-label={$sideBarStore && !$DynamicGUI ? 'Close sidebar' : 'Open sidebar'}
        onclick={() => {
            if ($sideBarClosing) {
                return
            }
            if ($sideBarStore && !$DynamicGUI) {
                sideBarClosing.set(true)
            } else {
                sideBarClosing.set(false)
                sideBarStore.set(true)
            }
        }}
        class={"absolute top-3 left-0 h-12 w-12 border-r border-b border-t rounded-r-md bg-darkbg hover:border-neutral-200 transition-all duration-200 ease-out flex items-center justify-center text-textcolor z-20 " + (($sideBarStore && !$DynamicGUI) ? 'border-transparent' : 'border-borderc opacity-50 hover:opacity-90')}
    >
        <span
            aria-hidden="true"
            class="absolute inset-0 flex items-center justify-center pointer-events-none transition-all duration-200 ease-out"
            class:opacity-100={$sideBarStore && !$DynamicGUI}
            class:opacity-0={!($sideBarStore && !$DynamicGUI)}
            class:translate-x-0={$sideBarStore && !$DynamicGUI}
            class:translate-x-1={!($sideBarStore && !$DynamicGUI)}
        >
            <ArrowLeft />
        </span>
        <span
            aria-hidden="true"
            class="absolute inset-0 flex items-center justify-center pointer-events-none transition-all duration-200 ease-out"
            class:opacity-100={!($sideBarStore && !$DynamicGUI)}
            class:opacity-0={$sideBarStore && !$DynamicGUI}
            class:translate-x-0={!($sideBarStore && !$DynamicGUI)}
            class:translate-x-1={$sideBarStore && !$DynamicGUI}
        >
            <ArrowRight />
        </span>
    </button>
{/if}
