<script lang="ts">
    import type { character, Message, StreamingDisplayOptimizationMode } from 'src/ts/storage/database.svelte';
    import { mount, onDestroy, onMount, unmount } from 'svelte';
    import Chat from './Chat.svelte';
    import { getCharImage } from 'src/ts/characters';
    import { createSimpleCharacter, DBState, selectedCharID, ReloadChatPointer } from 'src/ts/stores.svelte';
    import { chatFoldedStateMessageIndex } from 'src/ts/globalApi.svelte';
    import { get } from 'svelte/store';
    import { scrollWithinContainer } from './scrollWithin';
    
    const getCurrentChatRoomId = () => {
        const charId = get(selectedCharID);
        if (charId < 0) return null;
        const char = DBState.db.characters[charId];
        if (!char) return null;
        return char.chats?.[char.chatPage]?.id ?? null;
    };

    let {
        messages,
        currentCharacter,
        onReroll,
        onNextSwipe = () => {},
        unReroll,
        onDeleteSwipe = () => {},
        currentUsername,
        userIcon,
        loadPages,
        userIconPortrait,
        hasNewUnreadMessage = $bindable(false)
    }:{
        messages: Message[]
        currentCharacter: character
        onReroll: () => void
        onNextSwipe?: () => void
        unReroll: () => void
        onDeleteSwipe?: () => void
        currentUsername: string
        userIcon: string
        loadPages: number
        userIconPortrait?: boolean
        hasNewUnreadMessage?: boolean
    } = $props();

    let chatBody: HTMLDivElement;
    let hashes: Set<number> = new Set();
    type ChatInstance = {
        updateStreamingDisplay?: (state: {
            isOptimizedStreamingMessage: boolean
            streamingOptimizationMode: StreamingDisplayOptimizationMode
            rawStreamingText: string
        }) => void
        updateRerollTarget?: (state: {
            rerollIcon: boolean|'dynamic'|'force'
            onNextSwipe: () => void
            onDeleteSwipe: () => void
            currentPage: number
            totalPages: number
        }) => void
    }
    let mountInstances: Map<number, ChatInstance> = new Map();
    let mountedElements: Map<number, HTMLElement> = new Map();

    //Non-cryptographic hash function to generate a unique hash for each message
    function hashCode(str:string):number {
        let hash = 0;
        for (let i = 0, len = str.length; i < len; i++) {
            let chr = str.charCodeAt(i);
            hash = (hash << 5) - hash + chr;
            hash |= 0; // Convert to 32bit integer
        }
        if(hash == 0){
            hash = 1; // Ensure hash is not zero
        }
        return hash;
    }

    const rerollTargetState = (message: Message, isRerollTarget: boolean) => isRerollTarget ? {
        rerollIcon: 'force' as const,
        onNextSwipe,
        onDeleteSwipe,
        currentPage: (message.swipeId ?? 0) + 1,
        totalPages: message.swipes?.length ?? 1,
    } : {
        rerollIcon: false as const,
        onNextSwipe: () => {},
        onDeleteSwipe: () => {},
        currentPage: 1,
        totalPages: 1,
    };

    const updateChatBody = () => {
        if(!chatBody){
            return
        }

        let nextHash = 0;
        let currentHashes: Set<number> = new Set();
        const charImage = getCharImage(currentCharacter.image, 'css')
        const userImage = getCharImage(userIcon, 'css')
        const simpleChar = createSimpleCharacter(currentCharacter);
        let loadStart = messages.length - 1
        let loadEnd = messages.length - loadPages
        const currentChat = currentCharacter.chats?.[currentCharacter.chatPage]
        const configuredPerformanceMode = DBState.db.streamingDisplayOptimizationMode ?? 'off';
        const performanceMode = currentChat?.isStreaming
            ? currentChat.activeStreamingDisplayOptimizationMode ?? configuredPerformanceMode
            : configuredPerformanceMode
        // Update the streaming message in place in every mode; keying it by its
        // text (as 'off' used to) remounted it on every chunk.
        const activeStreamingIndex = currentChat?.isStreaming
            ? messages.length - 1
            : -1

        // Find the last real (non-comment, non-disabled) char message index
        // Only show reroll if it's the actual last non-disabled message
        let lastRealCharIdx = -1;
        let lastNonDisabledIdx = -1;
        for (let i = messages.length - 1; i >= 0; i--) {
            if (!messages[i].isComment && !messages[i].disabled) {
                lastNonDisabledIdx = i;
                break;
            }
        }
        if (lastNonDisabledIdx >= 0 && messages[lastNonDisabledIdx].role === 'char') {
            lastRealCharIdx = lastNonDisabledIdx;
        }

        const streamingIndex = currentChat?.isStreaming ? messages.length - 1 : -1
        const showStreamingCursor = DBState.db.streamingCursor !== false

        // Containers by message index, so a remount (edited message) can keep
        // the old height until the new body has rendered.
        const previousByIndex = new Map<number, HTMLElement>()
        for(const el of mountedElements.values()){
            const index = Number(el.dataset.chatIndex)
            if(Number.isFinite(index)) previousByIndex.set(index, el)
        }

        if(chatFoldedStateMessageIndex.index !== -1){
            loadStart = chatFoldedStateMessageIndex.index
            loadEnd = Math.max(0, chatFoldedStateMessageIndex.index - loadPages)
        }

        const reloadPointerMap = get(ReloadChatPointer);

        for(let i=loadStart ; i >= loadEnd; i--){
            if(i < 0) break; // Prevent out of bounds
            const message = messages[i];
            const messageLargePortrait = message.role === 'user' ? (userIconPortrait ?? false) : ((currentCharacter as character).largePortrait ?? false);
            const reloadPointer = reloadPointerMap[i] ?? 0;
            const isRerollTarget = i === lastRealCharIdx;
            const activeStreamingMessage = i === activeStreamingIndex && message.role === 'char';
            const hashMessageData = activeStreamingMessage ? '' : message.data;
            let hashd = hashMessageData + (message.chatId ?? '') + i.toString() + messageLargePortrait.toString() + message.disabled?.toString() + reloadPointer.toString() + (message.swipeId ?? 0).toString() + (message.swipes?.length ?? 0).toString();
            const currentHash = hashCode(hashd);
            currentHashes.add(currentHash);
            const isStreamingMessage = showStreamingCursor && i === streamingIndex && message.role === 'char';
            if(!hashes.has(currentHash)){
                const b = document.createElement('div');
                b.setAttribute('x-hashed', currentHash.toString());
                b.dataset.chatIndex = i.toString();
                b.classList.add('chat-message-container');
                b.classList.toggle('risu-streaming', isStreamingMessage);
                const replaced = previousByIndex.get(i);
                if(replaced && replaced.isConnected){
                    // The new body parses asynchronously and starts empty; holding the
                    // old height avoids a collapse that would shift everything around it.
                    const h = replaced.offsetHeight;
                    if(h > 0){
                        b.style.minHeight = `${h}px`;
                        holdMinHeight(b);
                    }
                }
                const inst = mount(Chat, {
                    target: b,
                    props: {
                        message: message.data,
                        isLastMemory: false,
                        idx: i,
                        totalLength: messages.length,
                        img: message.role === 'user' ? userImage : charImage,
                        onReroll: onReroll,
                        unReroll: unReroll,
                        ...rerollTargetState(message, isRerollTarget),
                        character: simpleChar,
                        largePortrait: messageLargePortrait,
                        messageGenerationInfo: message.generationInfo,
                        role: message.role,
                        name: message.role === 'user' ? currentUsername : currentCharacter.name,
                        isComment: message.isComment ?? false,
                        disabled: message.disabled ?? false,
                        isOptimizedStreamingMessage: activeStreamingMessage,
                        streamingOptimizationMode: performanceMode,
                        rawStreamingText: message.data,
                    },

                })
                mountInstances.set(currentHash, inst);
                mountedElements.set(currentHash, b);
                const nextElement = nextHash === 0 ? null : chatBody.querySelector(`[x-hashed="${nextHash}"]`);
                if(nextElement){
                    chatBody.insertBefore(b, nextElement?.nextSibling);
                }
                else{
                    chatBody.prepend(b);
                }
            }
            else{
                const el = mountedElements.get(currentHash)
                el?.classList.toggle('risu-streaming', isStreamingMessage)
                const inst = mountInstances.get(currentHash)
                inst?.updateStreamingDisplay?.({
                    isOptimizedStreamingMessage: activeStreamingMessage,
                    streamingOptimizationMode: performanceMode,
                    rawStreamingText: message.data,
                })
                // A message that stopped being the reroll target must also drop its
                // swipe-delete control: onDeleteSwipe acts on the current last message.
                inst?.updateRerollTarget?.(rerollTargetState(message, isRerollTarget))
            }
            nextHash = currentHash;

        }

        //@ts-expect-error Set<T> requires type arg, and Set.difference needs 'esnext' lib (polyfilled by Core-js)
        const toRemove:Set = hashes.difference(currentHashes);
        toRemove.forEach((hash) => {
            const inst = mountInstances.get(hash);
            if(inst){
                unmount(inst);
                mountInstances.delete(hash);
            }
            mountedElements.delete(hash);
            const element = chatBody.querySelector(`[x-hashed="${hash}"]`);
            if(element){
                chatBody.removeChild(element);
            }
        });

        hashes = currentHashes;
    };

    onDestroy(() => {
        console.log('Unmounting Chats');
        hashes.clear();
        mountedElements.clear();
        mountInstances.forEach((inst) => {
            unmount(inst);
        });
        mountInstances.clear();
    })

    function checkIfAtBottom() {
        if (!chatBody || !chatBody.parentElement) return true;
        const sc = chatBody.parentElement;
        const lastEl = chatBody.firstElementChild;
        if (!lastEl) return true;
        const rect = lastEl.getBoundingClientRect();
        const scRect = sc.getBoundingClientRect();
        return rect.top <= scRect.bottom + 100;
    }

    function scrollLatestIntoChatScreen() {
        if(!chatBody) return;
        const element = chatBody.firstElementChild as HTMLElement | null;
        const chatScreen = chatBody.parentElement;
        if(!element || !chatScreen) return;
        scrollWithinContainer(element, chatScreen, { block: 'start', behavior: 'instant' });
    }

    export const scrollToLatestMessage = () => {
        if(!chatBody) return;
        releasePin();
        hasNewUnreadMessage = false;
        scrollLatestIntoChatScreen();
    }

    function holdMinHeight(el: HTMLElement) {
        setTimeout(() => {
            el.style.minHeight = '';
        }, 400);
    }

    // ---- Scroll anchoring ------------------------------------------------
    // The scroller is flex-col-reverse, so its offset is kept relative to the
    // bottom: when a message below the viewport grows (streaming), shrinks or
    // is remounted (edit), the text being read slides away. Native
    // overflow-anchor is unreliable here (and absent on iOS Safari), so the
    // top-most visible message is anchored by index and its on-screen
    // position restored after every layout change. At the very bottom the
    // col-reverse behavior (follow the newest text) is kept.
    const ANCHOR_TOP_MARGIN = 8;
    let scroller: HTMLElement | null = null;
    let anchor: { index: number, offset: number } | null = null;
    let pinnedToBottom = true;
    let touching = false;
    let scrollFrame: number | null = null;
    // chatId of the streaming reply we already stopped following, so scrolling
    // back to the bottom resumes following instead of stopping again.
    let stoppedFollowingFor: string | null = null;

    function isAtScrollEnd(sc: HTMLElement) {
        if (getComputedStyle(sc).flexDirection === 'column-reverse') {
            return Math.abs(sc.scrollTop) <= 2;
        }
        return sc.scrollHeight - sc.clientHeight - sc.scrollTop <= 2;
    }

    function findMessageElement(index: number) {
        return chatBody?.querySelector(`:scope > [data-chat-index="${index}"]`) as HTMLElement | null;
    }

    function captureAnchor() {
        if (!scroller || !chatBody) return;
        const top = scroller.getBoundingClientRect().top;
        let best: HTMLElement | null = null;
        let bestTop = Infinity;
        for (const child of chatBody.children) {
            const el = child as HTMLElement;
            if (!el.dataset.chatIndex) continue;
            const rect = el.getBoundingClientRect();
            if (rect.height === 0 || rect.bottom <= top + 1) continue;
            if (rect.top < bestTop) {
                bestTop = rect.top;
                best = el;
            }
        }
        anchor = best ? { index: Number(best.dataset.chatIndex), offset: bestTop - top } : null;
    }

    function streamingMessageKey(): { index: number, key: string } | null {
        const chat = currentCharacter?.chats?.[currentCharacter.chatPage];
        if (!chat?.isStreaming || messages.length === 0) return null;
        const last = messages[messages.length - 1];
        if (last?.role !== 'char') return null;
        return { index: messages.length - 1, key: last.chatId ?? String(messages.length - 1) };
    }

    // pinStart mode: a reply that starts while at the bottom is shown from its
    // first line at once (a short user prompt kept above it) and stays put
    // while it streams. chatBody's bottom padding reserves room below a short
    // reply so it can sit at the top and grow downward without moving
    // anything. The pin holds until the user scrolls or the next message
    // arrives; the reserved room stays until then so the view does not drop.
    let pinnedReply: { index: number, key: string, offset: number } | null = null;
    let replySpacer = 0;

    function setReplySpacer(px: number) {
        replySpacer = px;
        if (chatBody) chatBody.style.paddingBottom = px > 0 ? `${px}px` : '';
    }

    function pinOffset(sc: HTMLElement, index: number, el: HTMLElement) {
        const prev = findMessageElement(index - 1);
        if (prev && messages[index - 1]?.role === 'user' && prev.offsetHeight < sc.clientHeight / 3) {
            return ANCHOR_TOP_MARGIN + el.getBoundingClientRect().top - prev.getBoundingClientRect().top;
        }
        return ANCHOR_TOP_MARGIN;
    }

    function fitReplySpacer(sc: HTMLElement) {
        const el = pinnedReply && findMessageElement(pinnedReply.index);
        if (!pinnedReply || !el) return;
        const scrolledFromTop = getComputedStyle(sc).flexDirection === 'column-reverse'
            ? sc.scrollHeight - sc.clientHeight + sc.scrollTop
            : sc.scrollTop;
        const elContentTop = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + scrolledFromTop;
        const below = sc.scrollHeight - replySpacer - elContentTop;
        setReplySpacer(Math.max(0, Math.ceil(sc.clientHeight - pinnedReply.offset - below)));
    }

    function releasePin() {
        pinnedReply = null;
    }

    function restoreAnchor() {
        const sc = scroller;
        if (!sc || !chatBody || touching) return;
        const scTop = sc.getBoundingClientRect().top;

        if (!pinnedReply && (DBState.db.streamingScrollMode ?? 'stopAtStart') === 'pinStart') {
            const streaming = streamingMessageKey();
            const el = streaming && stoppedFollowingFor !== streaming.key ? findMessageElement(streaming.index) : null;
            // Decided once per reply, when it appears. Check the position
            // itself: pinnedToBottom can lag behind when the view reached the
            // end without a scroll event.
            if (streaming && el) {
                stoppedFollowingFor = streaming.key;
                if (pinnedToBottom || isAtScrollEnd(sc)) {
                    pinnedReply = { ...streaming, offset: pinOffset(sc, streaming.index, el) };
                    pinnedToBottom = false;
                }
            }
        }
        if (pinnedReply) {
            fitReplySpacer(sc);
            anchor = { index: pinnedReply.index, offset: pinnedReply.offset };
        }

        if (pinnedToBottom) {
            if ((DBState.db.streamingScrollMode ?? 'stopAtStart') !== 'stopAtStart') return;
            const streaming = streamingMessageKey();
            if (!streaming || stoppedFollowingFor === streaming.key) return;
            const el = findMessageElement(streaming.index);
            if (!el) return;
            const elTop = el.getBoundingClientRect().top;
            if (elTop >= scTop + ANCHOR_TOP_MARGIN) return;
            // The reply's first line reached the top: stop following and keep it there.
            stoppedFollowingFor = streaming.key;
            pinnedToBottom = false;
            sc.scrollTop += elTop - (scTop + ANCHOR_TOP_MARGIN);
            anchor = { index: streaming.index, offset: ANCHOR_TOP_MARGIN };
            return;
        }

        if (!anchor) {
            captureAnchor();
            return;
        }
        const el = findMessageElement(anchor.index);
        if (!el) {
            captureAnchor();
            return;
        }
        const delta = el.getBoundingClientRect().top - scTop - anchor.offset;
        if (Math.abs(delta) >= 1) {
            sc.scrollTop += delta;
        }
    }

    function onScrollerScroll() {
        if (scrollFrame !== null) return;
        scrollFrame = requestAnimationFrame(() => {
            scrollFrame = null;
            if (!scroller || pinnedReply) return;
            pinnedToBottom = isAtScrollEnd(scroller);
            captureAnchor();
        });
    }

    // Scrolling by hand releases a pinned reply. Typing in the composer or a
    // click on a button inside the scroller does not.
    const PIN_SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' ']);
    function releasePinByUser() {
        if (!pinnedReply) return;
        releasePin();
        // The scroll this input starts moves the view before the next frame
        // re-captures the anchor; dropping the pinned anchor keeps a streaming
        // update in between from snapping the view back to the reply.
        anchor = null;
        onScrollerScroll();
    }
    const onWheel = () => releasePinByUser();
    const onPointerDown = (e: PointerEvent) => {
        if (e.target === scroller) releasePinByUser();
    };
    const onKeyDown = (e: KeyboardEvent) => {
        const t = e.target as HTMLElement | null;
        if (t?.closest('input, textarea, select, [contenteditable="true"]')) return;
        if (PIN_SCROLL_KEYS.has(e.key)) releasePinByUser();
    };

    const onTouchStart = () => {
        touching = true;
        releasePinByUser();
    };
    const onTouchEnd = () => {
        touching = false;
        onScrollerScroll();
    };

    let resizeObserver: ResizeObserver | null = null;

    onMount(() => {
        scroller = chatBody?.parentElement ?? null;
        if (!scroller) return;
        scroller.style.overflowAnchor = 'none';
        scroller.addEventListener('scroll', onScrollerScroll, { passive: true });
        scroller.addEventListener('touchstart', onTouchStart, { passive: true });
        scroller.addEventListener('touchend', onTouchEnd, { passive: true });
        scroller.addEventListener('touchcancel', onTouchEnd, { passive: true });
        scroller.addEventListener('wheel', onWheel, { passive: true });
        scroller.addEventListener('pointerdown', onPointerDown);
        scroller.addEventListener('keydown', onKeyDown);
        pinnedToBottom = isAtScrollEnd(scroller);
        resizeObserver = new ResizeObserver(() => restoreAnchor());
        resizeObserver.observe(chatBody);
        resizeObserver.observe(scroller);
    });

    onDestroy(() => {
        resizeObserver?.disconnect();
        if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
        if (scroller) {
            scroller.removeEventListener('scroll', onScrollerScroll);
            scroller.removeEventListener('touchstart', onTouchStart);
            scroller.removeEventListener('touchend', onTouchEnd);
            scroller.removeEventListener('touchcancel', onTouchEnd);
            scroller.removeEventListener('wheel', onWheel);
            scroller.removeEventListener('pointerdown', onPointerDown);
            scroller.removeEventListener('keydown', onKeyDown);
        }
    });

    let previousLength = 0;
    let previousChatRoomId: string | null = null;

    $effect(() => {
        void $ReloadChatPointer; // Make $effect track ReloadChatPointer changes
        const wasAtBottom = checkIfAtBottom();
        updateChatBody()

        const currentChatRoomId = getCurrentChatRoomId();
        const isSameChat = currentChatRoomId === previousChatRoomId;
        const lengthGrew = isSameChat && messages.length > previousLength;
        if(!isSameChat || lengthGrew){
            // A pinned reply and its reserved room end with the next message.
            if(pinnedReply){
                releasePin();
                if(scroller) pinnedToBottom = isAtScrollEnd(scroller);
            }
            setReplySpacer(0);
        }
        if(isSameChat){
            restoreAnchor();
        }
        else{
            // Another chat: the old anchor index means nothing here.
            anchor = null;
            stoppedFollowingFor = null;
            pinnedToBottom = scroller ? isAtScrollEnd(scroller) : true;
        }

        // Only auto-scroll if it's the same chat and new messages were added
        // (a pinned reply is already shown from its start).
        if(lengthGrew && !pinnedReply){
            const lastMsg = messages[messages.length - 1];
            if(lastMsg && lastMsg.role === 'char' && DBState.db.autoScrollToNewMessage){
                if(wasAtBottom || DBState.db.alwaysScrollToNewMessage){
                    setTimeout(() => {
                        scrollLatestIntoChatScreen();
                    }, 700);
                } else {
                    hasNewUnreadMessage = true;
                }
            }
        }
        previousLength = messages.length;
        previousChatRoomId = currentChatRoomId;
    })

</script>

<div class="flex flex-col-reverse" bind:this={chatBody}></div>

<style>
    /* Blinking cursor at the end of a streaming reply (streamingCursor). */
    :global(.chat-message-container.risu-streaming :is(.chattext, .chattext > .risu-stream-body) > :last-child:not(style):not(script):not(br):not(.risu-stream-body)::after) {
        content: '';
        display: inline-block;
        width: 0.5em;
        height: 1em;
        margin-left: 0.15em;
        vertical-align: text-bottom;
        border-radius: 1px;
        background: currentColor;
        opacity: 0.6;
        animation: risu-stream-cursor 1s steps(1) infinite;
    }
    @keyframes -global-risu-stream-cursor {
        50% { opacity: 0; }
    }
    @media (prefers-reduced-motion: reduce) {
        :global(.chat-message-container.risu-streaming :is(.chattext, .chattext > .risu-stream-body) > :last-child:not(style):not(script):not(br):not(.risu-stream-body)::after) {
            animation: none;
        }
    }
</style>
