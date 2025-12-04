export function Footer() {
    return (
        <footer className="mt-12 pb-8 pt-6 border-t border-white/10">
            <div className="max-w-7xl mx-auto px-4">
                <p className="text-center text-sm text-slate-400">
                    Vibe Coded with{" "}
                    <span className="text-arena-accent font-semibold">Gemini 3 Pro Preview</span>,{" "}
                    <span className="text-arena-accent font-semibold">Claude Sonnet 4.5</span>,{" "}
                    <span className="text-arena-accent font-semibold">GPT-Codex 5.1-Max</span>, and{" "}
                    <span className="text-arena-accent font-semibold">Grok 4.1 Thinking</span>
                    {" "}using{" "}
                    <a
                        href="https://vercel.com/docs/ai-gateway"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-white hover:text-arena-accent transition-colors font-semibold"
                    >
                        Vercel AI Gateway
                    </a>
                    {" "}by{" "}
                    <a
                        href="https://github.com/Suspence00"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-white hover:text-arena-accent transition-colors font-semibold"
                    >
                        @Suspence00
                    </a>
                    {" "}with help from{" "}
                    <a
                        href="https://github.com/cwbcode"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-white hover:text-arena-accent transition-colors font-semibold"
                    >
                        @cwbcode
                    </a>
                </p>
            </div>
        </footer>
    );
}
