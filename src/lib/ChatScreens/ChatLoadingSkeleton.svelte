<script lang="ts">
    import { language } from "../../lang";

    const messageRows = [
        { avatar: 'assistant', widths: ['72%', '96%', '58%'] },
        { avatar: 'user', widths: ['46%', '88%', '76%'] },
        { avatar: 'assistant', widths: ['64%', '92%', '42%'] },
    ]
</script>

<div class="chat-loading-skeleton" role="status" aria-live="polite" aria-label={language.loadingChatData}>
    <div class="chat-loading-skeleton__heading">
        <span class="chat-loading-skeleton__dot"></span>
        <span>{language.loadingChatData}</span>
    </div>

    <div class="chat-loading-skeleton__messages" aria-hidden="true">
        {#each messageRows as row}
            <div class="chat-loading-skeleton__message">
                <span class:chat-loading-skeleton__avatar--user={row.avatar === 'user'} class="chat-loading-skeleton__avatar"></span>
                <div class="chat-loading-skeleton__copy">
                    <span class="chat-loading-skeleton__line chat-loading-skeleton__line--name" style={`width: ${row.avatar === 'user' ? '5rem' : '6.5rem'}`}></span>
                    {#each row.widths as width, index}
                        <span class="chat-loading-skeleton__line" class:chat-loading-skeleton__line--last={index === row.widths.length - 1} style={`width: ${width}`}></span>
                    {/each}
                </div>
            </div>
        {/each}
    </div>
</div>

<style>
    .chat-loading-skeleton {
        width: min(100%, 52rem);
        margin: 0 auto;
        padding: 1rem 1rem 3rem;
        color: var(--FontColorStandard);
    }

    .chat-loading-skeleton__heading {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin: 0 0 0.9rem;
        color: var(--risu-theme-textcolor2);
        font-size: 0.8rem;
        letter-spacing: 0.01em;
    }

    .chat-loading-skeleton__dot {
        width: 0.45rem;
        height: 0.45rem;
        border-radius: 999px;
        background: var(--risu-theme-borderc);
        animation: chat-loading-pulse 1.5s ease-in-out infinite;
    }

    .chat-loading-skeleton__messages {
        display: grid;
        gap: 0.75rem;
    }

    .chat-loading-skeleton__message {
        display: flex;
        gap: 0.75rem;
        min-height: 6.5rem;
        padding: 1rem;
        border: 1px solid color-mix(in srgb, var(--risu-theme-borderc) 22%, transparent);
        border-radius: 0.85rem;
        background: color-mix(in srgb, var(--risu-theme-bgcolor) 78%, transparent);
    }

    .chat-loading-skeleton__avatar,
    .chat-loading-skeleton__line {
        display: block;
        background: linear-gradient(
            100deg,
            color-mix(in srgb, var(--risu-theme-textcolor2) 12%, transparent) 20%,
            color-mix(in srgb, var(--risu-theme-textcolor2) 23%, transparent) 38%,
            color-mix(in srgb, var(--risu-theme-textcolor2) 12%, transparent) 55%
        );
        background-size: 220% 100%;
        animation: chat-loading-shimmer 1.8s ease-in-out infinite;
    }

    .chat-loading-skeleton__avatar {
        flex: 0 0 2.35rem;
        width: 2.35rem;
        height: 2.35rem;
        border-radius: 50%;
    }

    .chat-loading-skeleton__avatar--user {
        border-radius: 0.7rem;
    }

    .chat-loading-skeleton__copy {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 0.62rem;
        min-width: 0;
    }

    .chat-loading-skeleton__line {
        height: 0.62rem;
        max-width: 100%;
        border-radius: 999px;
    }

    .chat-loading-skeleton__line--name {
        height: 0.5rem;
        margin-bottom: 0.1rem;
        opacity: 0.72;
    }

    .chat-loading-skeleton__line--last {
        max-width: 78%;
    }

    @keyframes chat-loading-shimmer {
        0% { background-position: 100% 0; }
        100% { background-position: -100% 0; }
    }

    @keyframes chat-loading-pulse {
        0%, 100% { opacity: 0.35; transform: scale(0.9); }
        50% { opacity: 1; transform: scale(1); }
    }

    @media (prefers-reduced-motion: reduce) {
        .chat-loading-skeleton__avatar,
        .chat-loading-skeleton__line,
        .chat-loading-skeleton__dot {
            animation: none;
        }
    }
</style>
