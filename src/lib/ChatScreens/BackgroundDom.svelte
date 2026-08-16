<script lang="ts">
    import { ParseMarkdown, risuChatParser } from "src/ts/parser/parser.svelte";
    import { type character } from "src/ts/storage/database.svelte";
    import { DBState, legacyModuleBackgroundEmbedding, ReloadGUIPointer, selIdState } from "src/ts/stores.svelte";
    import { legacyBackgroundRenderer } from "src/ts/process/backgroundRenderer";
    import { getModuleBackgroundEmbedding, getModules } from "src/ts/process/modules";

    let backgroundHTML = $derived(DBState.db?.characters?.[selIdState.selId]?.backgroundHTML)
    let currentChar:character = $derived(DBState.db?.characters?.[selIdState.selId])
    let currentChat = $derived(currentChar?.chats?.[currentChar?.chatPage])
    let renderModules = $derived.by(() => {
        if ($legacyBackgroundRenderer) return []
        void currentChar?.modules?.length
        void currentChat?.modules?.length
        void DBState.db?.selectedPersona
        for (const script of currentChar?.customscript ?? []) {
            void script.in
            void script.out
            void script.type
            void script.flag
            void script.ableFlag
        }
        for (const trigger of currentChar?.triggerscript ?? []) {
            void trigger.type
            void trigger.comment
            void trigger.effect?.length
        }
        // Touch module payloads as well as membership IDs. getModules() keeps
        // an ID-based cache, so a background/regex edit must still invalidate
        // this derived render without requiring a module toggle.
        for (const module of DBState.db?.modules ?? []) {
            void module?.backgroundEmbedding
            for (const script of module?.regex ?? []) {
                void script.in
                void script.out
                void script.type
                void script.flag
                void script.ableFlag
            }
            for (const trigger of module?.trigger ?? []) {
                void trigger.type
                void trigger.comment
                void trigger.effect?.length
            }
            void module?.assets?.length
        }
        return getModules({ character: currentChar, chat: currentChat })
    })
    // Keep the old store and exact old ParseMarkdown mode behind the opt-out.
    // The default renderer receives the freshly recomputed module embedding.
    let moduleEmbedding = $derived.by(() => {
        if ($legacyBackgroundRenderer) {
            return $legacyModuleBackgroundEmbedding
        }
        // Explicitly resolve character/chat modules from this render's
        // context. The old moduleUpdate effect historically omitted some of
        // these memberships and also retained stale values globally.
        return getModuleBackgroundEmbedding({ modules: renderModules })
    })
    let backgroundData = $derived((backgroundHTML || '') + '\n' + (moduleEmbedding || ''))
    let renderFingerprint = $derived.by(() => {
        if ($legacyBackgroundRenderer) return ''
        return JSON.stringify({
            backgroundHTML,
            customscript: currentChar?.customscript,
            triggerscript: currentChar?.triggerscript,
            modules: renderModules.map((module) => ({
                id: module.id,
                backgroundEmbedding: module.backgroundEmbedding,
                regex: module.regex,
                trigger: module.trigger,
            })),
        })
    })

</script>


{#if backgroundHTML || moduleEmbedding}
    {#if selIdState.selId > -1}
        {#key `${$ReloadGUIPointer}|${$legacyBackgroundRenderer ? 'legacy' : 'isolated'}|${renderFingerprint}`}
            <div class="absolute top-0 left-0 w-full h-full" class:risu-background-root={!$legacyBackgroundRenderer}>
                {#await ParseMarkdown(
                    risuChatParser(backgroundData, {
                        chara: currentChar,
                        ...($legacyBackgroundRenderer ? {} : { modules: renderModules }),
                    }),
                    currentChar,
                    $legacyBackgroundRenderer ? 'back' : 'background',
                    -1,
                    {},
                    $legacyBackgroundRenderer ? undefined : {
                        target: 'background',
                        character: currentChar,
                        chat: currentChat,
                        modules: renderModules,
                    }
                ) then md}
                    {@html md}
                {/await}
            </div>
        {/key}
    {/if}
{/if}
