<script lang="ts">
    import { language } from "../../lang";

    const messageRows = [
        {
            nameWidth: '6.25rem',
            paragraphs: [
                ['42%', '76%'],
                ['91%', '84%', '58%'],
            ],
        },
        {
            nameWidth: '4.75rem',
            paragraphs: [
                ['68%', '94%', '72%'],
            ],
        },
    ]
</script>

<div class="chat-loading-skeleton" role="status" aria-live="polite" aria-label={language.loadingChatData}>
    <div class="chat-loading-skeleton__status">
        <span class="chat-loading-skeleton__spinner"></span>
        <span>{language.loadingChatData}</span>
    </div>

    <div class="chat-loading-skeleton__messages" aria-hidden="true">
        {#each messageRows as row, rowIndex}
            <div class="chat-loading-skeleton__message">
                <span
                    class="chat-loading-skeleton__avatar"
                    style={`--skeleton-delay: ${rowIndex * 120}ms`}
                ></span>

                <div class="chat-loading-skeleton__content">
                    <div class="chat-loading-skeleton__header">
                        <span
                            class="chat-loading-skeleton__line chat-loading-skeleton__line--name"
                            style={`width: ${row.nameWidth}; --skeleton-delay: ${rowIndex * 120 + 40}ms`}
                        ></span>
                        <span class="chat-loading-skeleton__actions">
                            <i></i><i></i><i></i><i></i>
                        </span>
                    </div>

                    {#each row.paragraphs as paragraph, paragraphIndex}
                        <div class="chat-loading-skeleton__paragraph">
                            {#each paragraph as width, lineIndex}
                                <span
                                    class="chat-loading-skeleton__line"
                                    style={`width: ${width}; --skeleton-delay: ${rowIndex * 120 + paragraphIndex * 70 + lineIndex * 45}ms`}
                                ></span>
                            {/each}
                        </div>
                    {/each}
                </div>
            </div>
        {/each}
    </div>
</div>

<style>
    .chat-loading-skeleton {
        box-sizing: border-box;
        width: 100%;
        padding: 1rem 1.5rem 2.5rem;
        color: var(--FontColorStandard);
    }

    .chat-loading-skeleton__status {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.55rem;
        min-height: 1.5rem;
        margin-bottom: 1.75rem;
        color: var(--risu-theme-textcolor2);
        font-size: 0.8rem;
        letter-spacing: 0.01em;
    }

    .chat-loading-skeleton__spinner {
        box-sizing: border-box;
        width: 0.9rem;
        height: 0.9rem;
        border: 2px solid color-mix(in srgb, var(--risu-theme-textcolor2) 24%, transparent);
        border-top-color: color-mix(in srgb, var(--risu-theme-textcolor2) 82%, transparent);
        border-radius: 50%;
        animation: chat-loading-spin 0.9s linear infinite;
    }

    .chat-loading-skeleton__messages {
        display: flex;
        flex-direction: column;
        gap: 2.5rem;
        width: 100%;
    }

    .chat-loading-skeleton__message {
        display: flex;
        align-items: flex-start;
        gap: 1rem;
        width: 100%;
        min-width: 0;
    }

    .chat-loading-skeleton__avatar,
    .chat-loading-skeleton__line {
        display: block;
        background: linear-gradient(
            100deg,
            color-mix(in srgb, var(--risu-theme-textcolor2) 12%, transparent) 18%,
            color-mix(in srgb, var(--risu-theme-textcolor2) 25%, transparent) 38%,
            color-mix(in srgb, var(--risu-theme-textcolor2) 12%, transparent) 58%
        );
        background-size: 220% 100%;
        animation: chat-loading-shimmer 1.8s ease-in-out var(--skeleton-delay, 0ms) infinite;
    }

    .chat-loading-skeleton__avatar {
        flex: 0 0 3.5rem;
        width: 3.5rem;
        height: 3.5rem;
        border-radius: 0.45rem;
        box-shadow: 0 0.25rem 0.75rem color-mix(in srgb, var(--risu-theme-darkbg) 28%, transparent);
    }

    .chat-loading-skeleton__content {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 1rem;
        min-width: 0;
        padding-top: 0.15rem;
    }

    .chat-loading-skeleton__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        min-height: 1.25rem;
    }

    .chat-loading-skeleton__actions {
        display: flex;
        align-items: center;
        gap: 0.55rem;
        padding-right: 0.25rem;
        opacity: 0.5;
    }

    .chat-loading-skeleton__actions i {
        display: block;
        width: 0.85rem;
        height: 0.85rem;
        border: 1.5px solid color-mix(in srgb, var(--risu-theme-textcolor2) 55%, transparent);
        border-radius: 0.2rem;
    }

    .chat-loading-skeleton__paragraph {
        display: flex;
        flex-direction: column;
        gap: 0.62rem;
        width: 100%;
    }

    .chat-loading-skeleton__line {
        height: 0.6rem;
        max-width: 100%;
        border-radius: 999px;
    }

    .chat-loading-skeleton__line--name {
        height: 0.8rem;
        max-width: 42%;
    }

    @keyframes chat-loading-shimmer {
        0% { background-position: 100% 0; }
        100% { background-position: -100% 0; }
    }

    @keyframes chat-loading-spin {
        to { transform: rotate(360deg); }
    }

    @media (max-width: 640px) {
        .chat-loading-skeleton {
            padding: 0.75rem 1rem 2rem;
        }

        .chat-loading-skeleton__status {
            margin-bottom: 1.25rem;
        }

        .chat-loading-skeleton__messages {
            gap: 2rem;
        }

        .chat-loading-skeleton__message {
            gap: 0.75rem;
        }

        .chat-loading-skeleton__avatar {
            flex-basis: 3rem;
            width: 3rem;
            height: 3rem;
        }

        .chat-loading-skeleton__actions i:nth-child(-n + 2) {
            display: none;
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .chat-loading-skeleton__avatar,
        .chat-loading-skeleton__line,
        .chat-loading-skeleton__spinner {
            animation: none;
        }
    }
</style>
