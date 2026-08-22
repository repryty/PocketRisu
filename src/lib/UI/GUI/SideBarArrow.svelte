<script lang="ts">
    import { ArrowLeft, ArrowRight } from "@lucide/svelte";
    import { DBState, DynamicGUI, MobileGUI, leftBarCollapsed, sideBarClosing, sideBarStore } from "src/ts/stores.svelte";

    // The toggle is viewport-fixed rather than absolutely positioned inside
    // ChatScreen. On narrow screens the sidebar is a shrink-0 flex item that
    // would push ChatScreen (and any button anchored to it) off-screen, hiding
    // the only close control. A fixed element ignores that flex layout and
    // stays in the viewport.
    //
    // `left` tracks the sidebar's right edge. On narrow screens the sidebar
    // track clamps its own width to `100vw - --sidebar-gutter`, leaving a
    // right-side gutter; this button uses the identical clamped value, so it
    // sits in that gutter — attached to the panel edge with a small gap to the
    // viewport — and on desktop it sits at the normal sidebar/chat boundary.
    // The position uses the same --sidebar-size variable and collapsed-screen
    // rule as the sidebar track, so it stays aligned with the panel edge. Its
    // transition matches the track's animation duration/easing, so the button
    // slides in lockstep with the sidebar open/close animation.
    const isOpen = $derived($sideBarStore && !$sideBarClosing && !$DynamicGUI)
    const showCloseIcon = $derived($sideBarStore && !$DynamicGUI)
    // Mirror the track's `left-bar-collapsed` condition exactly: the icon rail
    // only collapses on non-menuSideBar layouts.
    const collapsed = $derived($leftBarCollapsed && !DBState.db.menuSideBar)
</script>

{#if !$MobileGUI}
    <button
        type="button"
        aria-label={showCloseIcon ? 'Close sidebar' : 'Open sidebar'}
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
        class={"sidebar-arrow fixed top-3 h-12 w-12 border-r border-b border-t rounded-r-md bg-darkbg hover:border-neutral-200 flex items-center justify-center text-textcolor z-20 "
            + (isOpen ? 'sidebar-arrow-open' : 'sidebar-arrow-closed')
            + (showCloseIcon ? ' border-transparent' : ' border-borderc opacity-50 hover:opacity-90')
            + (collapsed ? ' left-bar-collapsed' : '')}
    >
        <span
            aria-hidden="true"
            class="absolute inset-0 flex items-center justify-center pointer-events-none transition-all duration-200 ease-out"
            class:opacity-100={showCloseIcon}
            class:opacity-0={!showCloseIcon}
            class:translate-x-0={showCloseIcon}
            class:translate-x-1={!showCloseIcon}
        >
            <ArrowLeft />
        </span>
        <span
            aria-hidden="true"
            class="absolute inset-0 flex items-center justify-center pointer-events-none transition-all duration-200 ease-out"
            class:opacity-100={!showCloseIcon}
            class:opacity-0={showCloseIcon}
            class:translate-x-0={!showCloseIcon}
            class:translate-x-1={showCloseIcon}
        >
            <ArrowRight />
        </span>
    </button>
{/if}

<style>
  .sidebar-arrow {
    /* Slide with the sidebar track: same duration (--risu-animation-speed)
       and easing so the button arrives at the edge exactly when the panel
       does. Transition the visual state changes too. */
    transition:
      left var(--risu-animation-speed) ease,
      opacity var(--risu-animation-speed) ease,
      border-color var(--risu-animation-speed) ease;
  }

  /* Closed: the open button sits at the viewport's left edge. */
  .sidebar-arrow-closed {
    left: 0;
  }

  /* Open: sit at the sidebar's right edge (icon rail + panel). This mirrors
     the sidebar track's clamped width exactly, so on narrow screens the button
     lands in the right-side gutter the track leaves — attached to the panel
     edge, with a small gap to the viewport edge — and on desktop it sits at the
     normal sidebar/chat boundary. */
  .sidebar-arrow-open {
    left: min(
      calc(5rem + var(--sidebar-size, 24rem)),
      100vw - var(--sidebar-gutter, 3.5rem)
    );
  }

  /* When the icon rail is collapsed on narrow screens the sidebar is just the
     panel, so the visible edge is the panel width. Mirror the track's rule. */
  @media (max-width: 25rem) {
    .sidebar-arrow-open.left-bar-collapsed {
      left: min(
        var(--sidebar-size, 24rem),
        100vw - var(--sidebar-gutter, 3.5rem)
      );
    }
  }
</style>
