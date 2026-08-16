<script lang="ts">
    import { language } from 'src/lang';
    import ShSwitch from 'src/lib/UI/GUI/ShSwitch.svelte';
    import { legacyBackgroundRenderer, setLegacyBackgroundRenderer } from 'src/ts/process/backgroundRenderer';

    let enabled = $state(false);

    const unsubscribe = legacyBackgroundRenderer.subscribe((value) => {
        enabled = value;
    });

    $effect(() => unsubscribe);
</script>

<div class="flex items-center justify-between gap-3 py-3 border-t border-darkborderc">
    <div class="flex flex-col min-w-0">
        <span class="text-sm text-textcolor">{language.legacyBackgroundRenderer}</span>
        <p class="text-xs text-textcolor2 mt-0.5">{language.help.legacyBackgroundRenderer}</p>
    </div>
    <ShSwitch checked={enabled} onCheckedChange={(value) => setLegacyBackgroundRenderer(value)} />
</div>
