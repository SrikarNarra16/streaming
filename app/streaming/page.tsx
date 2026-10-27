// app/streaming/page.tsx
"use client";

import React, { useCallback, useEffect, useState, useRef } from "react";
import ReactMarkdown from "react-markdown";

import { PerformanceSummary } from "@/components/streaming/PerformanceSummary";
import { ChatAccordion } from "@/components/streaming/ChatAccordion";
import { ModernBlankInput } from "@/components/streaming/ModernBlankInput";
import { ModernAIOutputDisplay } from "@/components/streaming/ModernAIOutputDisplay";
import { nextToken, isBlankAnswerCorrect } from "@/lib/content";
import { nextNearBottom, scrollBehaviorFor } from "@/lib/scroll";
import { shouldTypeOnResume } from "@/lib/streaming-flow";
import { CHARS_PER_SECOND, charsAllowed, discardUnusedChars, newTypingClock, takeAllowedChars, tickTypingClock, type TypingClock } from "@/lib/typing-clock";
import { createTimerSet } from "@/lib/timers";
import { useQuestionContent } from "@/lib/trace/use-question-content";
// Change AI Thinks
// Fix output code markdown


interface Question {
  id: number;
  question: string;
  content: string;
  answer: string;
}

interface ParagraphAccordion {
  id: string;
  position: number;
  chatMessages: Array<{ role: "user" | "ai"; message: string }>;
  paragraphContext: string;
  userFeedback?: "understood" | "did_not_understand";
}

interface BlankResponse {
    userAnswer: string;
    correctAnswer: string;
    isCorrect: boolean;
    position: number;
}
  
const TYPING_INTERVAL_MS = 10;
const CHARS_PER_TYPE_INTERVAL = 1;
const FEEDBACK_DURATION_MS = 1500;

// How the text is typed. "legacy" (the default, what learners have always seen): one character per 10 ms timer
// tick, whose real speed depends on rendering. "raf": the characters shown follow the active time
// (requestAnimationFrame) at CHARS_PER_SECOND (lib/typing-clock.ts). Do NOT switch to "raf" until CHARS_PER_SECOND
// has been set from a measurement of the legacy loop (a guard test fails otherwise).
const TYPING_CLOCK = "legacy" as "raf" | "legacy";

// The text being typed. Memoised, so a keystroke in the blank input does not render the paragraph again.
const TypedText = React.memo(function TypedText({ text }: { text: string }) {
    return <ReactMarkdown components={markdownComponents}>{text}</ReactMarkdown>;
});

const markdownComponents = {
    p: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => <p className="mb-4 leading-relaxed" {...props}>{children}</p>,
    code: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => {
    // If code contains line breaks, render as code block
    const codeText = children?.toString() || "";
    if (codeText.includes("\n")) {
        return (
            <pre className="bg-gray-800 p-4 rounded mt-2 mb-4 overflow-x-auto border border-gray-600">
                <code className="text-green-300 font-mono text-sm" {...props}>{codeText}</code>
            </pre>
        );
    }
    return <code className="bg-gray-700 px-2 py-1 rounded text-yellow-300 font-mono text-sm" {...props}>{children}</code>;
},
    pre: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => <pre className="bg-gray-800 p-4 rounded mt-2 mb-4 overflow-x-auto border border-gray-600" {...props}><code className="text-green-300 font-mono text-sm">{children}</code></pre>,
    strong: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => {
        const text = children?.toString() || "";
        if (text.includes("✓")) return <span className="font-bold text-green-400 bg-green-900/30 px-2 py-1 rounded" {...props}>{children}</span>;
        if (text.includes("✗")) return <span className="font-bold text-red-400 bg-red-900/30 px-2 py-1 rounded" {...props}>{children}</span>;
        return <strong className="font-bold text-blue-300" {...props}>{children}</strong>;
    },
};


function StreamingPage() {
  // --- LOGGING FUNCTION ---
  const logButtonClick = async (action: string, details: Record<string, unknown> = {}, level: string = "info") => {
    try {
      await fetch("/api/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, details, level }),
      });
    } catch (error) {
      console.error("Log error:", error);
    }
  };

  // Logout handler using provided logic
  const handleLogout = async () => {
    await logButtonClick("logout_button_click", {}, "info");
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.href = "/auth/login";
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

    // Question state
    const [allQuestions, setAllQuestions] = useState<Question[]>([]);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
    const [isLoadingQuestions, setIsLoadingQuestions] = useState(true);

    // The stored content, or (only with NEXT_PUBLIC_LIVE_TRACE=true) the live trace with draft blanks.
    const { content: aiText, loading: isContentLoading } = useQuestionContent(currentQuestion);

    // Core streaming state
    const [isTyping, setIsTyping] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [isStreamingSessionActive, setIsStreamingSessionActive] = useState(false);
    const [isContentComplete, setIsContentComplete] = useState(false);
    
    // Content management
    const [completedContent, setCompletedContent] = useState<React.ReactNode[]>([]);
    const [completedParagraphs, setCompletedParagraphs] = useState<string[]>([]);
    const [currentParagraph, setCurrentParagraph] = useState("");
    const [displayedCurrentParagraph, setDisplayedCurrentParagraph] = useState("");
    
    // Position tracking
    const [textPosition, setTextPosition] = useState(0);
    const [displayPosition, setDisplayPosition] = useState(0);
    
    // Interactive states
    const [isWaitingForFeedback, setIsWaitingForFeedback] = useState(false);
    const [isWaitingForBlankFill, setIsWaitingForBlankFill] = useState(false);
    const [currentBlankAnswer, setCurrentBlankAnswer] = useState<string | null>(null);
    const [userInput, setUserInput] = useState("");
    const [feedbackMessage, setFeedbackMessage] = useState("");
    const [blankResponses, setBlankResponses] = useState<BlankResponse[]>([]);
    const [justCompletedBlank, setJustCompletedBlank] = useState(false);
    
    // AI Output display state
    const [showAIOutput, setShowAIOutput] = useState(false);
    const [showAIPrompt, setShowAIPrompt] = useState(false);
    const [streamedAIAnswer, setStreamedAIAnswer] = useState("");
    const [isStreamingAIAnswer, setIsStreamingAIAnswer] = useState(false);

    // Chat accordion state
    const [activeAccordion, setActiveAccordion] = useState<ParagraphAccordion | null>(null);
    const [currentChatInput, setCurrentChatInput] = useState("");
    const [isLoadingResponse, setIsLoadingResponse] = useState(false);
    
    const bottomRef = useRef<HTMLDivElement>(null);

    // Auto-scroll state. These are refs, not state, so scrolling never causes a re-render.
    const nearBottomRef = useRef(true); // is the user following the bottom of the page?
    const lastScrollYRef = useRef(0);
    const scrollFrameRef = useRef<number | null>(null); // pending animation frame, at most one
    const smoothPendingRef = useRef(false); // a block appeared since the last scroll

    // Token for the showAIAnswer loop: incremented to cancel it (on reset, next question and unmount).
    const answerStreamTokenRef = useRef(0);

    // The one-off timers of the flow (paragraph end 200 ms, "Ok" prompt 500 ms, blank feedback 1500 ms).
    // All are cancelled on reset, next question and unmount, so none can update state afterwards.
    const [timers] = useState(createTimerSet);
    // The typing loop stopped at a paragraph break and the learner has not answered the feedback yet.
    const paragraphEndRef = useRef(false);
    // The newest values, for timers that fire later (a closure would hold the values of the render that set it).
    const latestRef = useRef({ isPaused: false, isWaitingForBlankFill: false });
    latestRef.current = { isPaused, isWaitingForBlankFill };
    // The "raf" typing clock: active time, characters shown so far, and the newest text position.
    const typingClockRef = useRef<TypingClock>(newTypingClock());
    const typedCharsRef = useRef(0);
    const textPositionRef = useRef(0);
    textPositionRef.current = textPosition;

    useEffect(() => {
        return () => {
            answerStreamTokenRef.current += 1;
            timers.clearAll();
        };
    }, [timers]);

    // Fetch all questions on component mount
    useEffect(() => {
        const fetchQuestions = async () => {
            setIsLoadingQuestions(true);
            try {
                const response = await fetch("/api/questions");
                if (!response.ok) throw new Error("Failed to fetch questions");
                
                const data = await response.json();
                setAllQuestions(data.questions);

                if (data.questions.length > 0) {
                    setCurrentQuestion(data.questions[0]);
                    setCurrentQuestionIndex(0);
                }
            } catch (error) {
                console.error("Error fetching questions:", error);
            } finally {
                setIsLoadingQuestions(false);
            }
        };

        fetchQuestions();
    }, []);

    // --- NEW ROBUST STREAMING LOGIC ---
    useEffect(() => {
        // Condition to run the effect: must be typing and not paused.
        if (TYPING_CLOCK !== "legacy" || !isTyping || isPaused) {
            return;
        }

        const handleTick = () => {
            // What comes next in the content is decided by lib/content.ts
            const token = nextToken(aiText, textPosition, CHARS_PER_TYPE_INTERVAL);

            // Check for end of content
            if (token.kind === "end") {
                setIsTyping(false);
                setIsContentComplete(true);
                setIsStreamingSessionActive(false);
                return;
            }

            // Check for BLANK
            if (token.kind === "blank") {
                setIsTyping(false); // Stop typing
                setIsWaitingForBlankFill(true);
                setCurrentBlankAnswer(token.answer);
                setTextPosition(textPosition + token.length);
                return; // End this tick
            }

            // Check for paragraph break - Custom paragraph break - $$
            if (token.kind === "paragraphBreak") {
                paragraphEndRef.current = true;
                setIsTyping(false); // Stop typing
                setTextPosition(textPosition + token.length);
                return; // End this tick
            }

            // Otherwise, type the next chunk
            setCurrentParagraph(prev => prev + token.text);
            setTextPosition(textPosition + token.length);
        };

        // Use a timeout to schedule the next tick. This creates a state-driven loop.
        const timeoutId = setTimeout(handleTick, TYPING_INTERVAL_MS);

        // Cleanup function to cancel the timeout if the component re-renders or unmounts
        return () => clearTimeout(timeoutId);

    }, [isTyping, isPaused, textPosition, aiText]);


    // --- TYPING CLOCK ("raf") ---
    // Each frame shows the characters that the active time allows (lib/typing-clock.ts). The clock only runs while
    // this effect runs (typing, not paused) and the tab is visible, so pause, a blank, the feedback box and a hidden
    // tab freeze it, and nothing is caught up afterwards. The stops at a blank, a paragraph break and the end are
    // the same as in the legacy loop above.
    useEffect(() => {
        if (TYPING_CLOCK !== "raf" || !isTyping || isPaused) return;
        let frameId = 0;
        let position = textPositionRef.current;

        const freeze = () => {
            typingClockRef.current = tickTypingClock(typingClockRef.current, performance.now(), false);
        };
        const onVisibility = () => {
            if (document.hidden) freeze();
        };
        document.addEventListener("visibilitychange", onVisibility);

        const frame = (now: number) => {
            typingClockRef.current = tickTypingClock(typingClockRef.current, now, !document.hidden);
            const allowed = charsAllowed(typingClockRef.current, CHARS_PER_SECOND);
            const taken = takeAllowedChars(aiText, position, typedCharsRef.current, allowed);
            position = taken.position;
            typedCharsRef.current = taken.shown;
            if (taken.text !== "") {
                const shown = taken.text;
                setCurrentParagraph(prev => prev + shown);
                setDisplayedCurrentParagraph(prev => prev + shown); // shown at once: the clock is the pace
                setDisplayPosition(prev => prev + shown.length);
            }
            setTextPosition(position);

            const stop = taken.stop;
            if (stop) {
                if (stop.kind === "end") {
                    setIsTyping(false);
                    setIsContentComplete(true);
                    setIsStreamingSessionActive(false);
                } else if (stop.kind === "blank") {
                    setIsTyping(false);
                    setIsWaitingForBlankFill(true);
                    setCurrentBlankAnswer(stop.answer);
                } else {
                    paragraphEndRef.current = true;
                    setIsTyping(false);
                }
                typingClockRef.current = discardUnusedChars(typingClockRef.current, typedCharsRef.current, CHARS_PER_SECOND);
                return; // typing has stopped: no next frame
            }
            frameId = requestAnimationFrame(frame);
        };
        frameId = requestAnimationFrame(frame);

        return () => {
            cancelAnimationFrame(frameId);
            document.removeEventListener("visibilitychange", onVisibility);
            freeze();
        };
    }, [isTyping, isPaused, aiText]);

    // --- DISPLAY ANIMATION ---
    useEffect(() => {
        if (isPaused || displayPosition >= currentParagraph.length) {
            // This logic runs when the paragraph has finished displaying
            if (displayPosition >= currentParagraph.length && !isTyping && currentParagraph.length > 0) {
                // (replaces a pending one; cancelled on reset, next question and unmount)
                timers.set(() => {
                    if (justCompletedBlank) {
                        setJustCompletedBlank(false);
                        if (!latestRef.current.isPaused) setIsTyping(true); // Resume typing
                    } else if (!latestRef.current.isWaitingForBlankFill) {
                        setIsWaitingForFeedback(true);
                    }
                }, 200, "paragraph-end");
            }
            return;
        }

        // Animation loop for displaying the current paragraph
        const intervalId = setInterval(() => {
            setDisplayPosition(prev => {
                const newPos = prev + CHARS_PER_TYPE_INTERVAL;
                setDisplayedCurrentParagraph(currentParagraph.slice(0, newPos));
                return newPos;
            });
        }, TYPING_INTERVAL_MS);

        return () => clearInterval(intervalId);
    }, [currentParagraph, displayPosition, isPaused, isTyping, justCompletedBlank, isWaitingForBlankFill, timers]);

    useEffect(() => {
        if (currentParagraph === "") {
            setDisplayPosition(0);
            setDisplayedCurrentParagraph("");
        }
    }, [currentParagraph]);
    
    // --- AUTO-SCROLL ---
    // The scroll container is the window: no wrapper sets overflow or a fixed height.
    // Follow the text only while the user is near the bottom; scroll at most once per animation frame.
    useEffect(() => {
        lastScrollYRef.current = window.scrollY;
        const onScroll = () => {
            const y = window.scrollY;
            nearBottomRef.current = nextNearBottom(nearBottomRef.current, {
                y,
                lastY: lastScrollYRef.current,
                distanceFromBottom: document.documentElement.scrollHeight - (y + window.innerHeight),
            });
            lastScrollYRef.current = y;
        };
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => {
            window.removeEventListener("scroll", onScroll);
            if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
        };
    }, []);

    const requestScroll = useCallback((smooth: boolean) => {
        if (!nearBottomRef.current) return;
        smoothPendingRef.current = smoothPendingRef.current || smooth; // a pending block scroll stays smooth
        if (scrollFrameRef.current !== null) return;
        scrollFrameRef.current = requestAnimationFrame(() => {
            scrollFrameRef.current = null;
            const smoothWanted = smoothPendingRef.current;
            smoothPendingRef.current = false;
            if (!nearBottomRef.current || !bottomRef.current) return;
            const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            bottomRef.current.scrollIntoView({ behavior: scrollBehaviorFor(smoothWanted, reducedMotion) });
        });
    }, []);

    // Text growing line by line: follow it instantly.
    useEffect(() => {
        requestScroll(false);
    }, [displayedCurrentParagraph, requestScroll]);

    // A whole block appeared or changed (feedback box, blank input, accordion, AI answer panel): smooth.
    useEffect(() => {
        requestScroll(true);
    }, [completedContent, isWaitingForBlankFill, isWaitingForFeedback, showAIOutput, activeAccordion, requestScroll]);

    // --- EVENT HANDLERS ---
    const handlePlayPause = () => {
        if (!currentQuestion) return;
        if (!isStreamingSessionActive && !isContentComplete) {
            logButtonClick("start_button_click", { questionId: currentQuestion.id });
            setIsStreamingSessionActive(true);
            setIsTyping(true);
            setIsPaused(false);
        } else if (isStreamingSessionActive) {
            logButtonClick(isPaused ? "resume_button_click" : "pause_button_click", { questionId: currentQuestion.id });
            setIsPaused(!isPaused);
            // Resume restarts the typing loop only if the pause interrupted typing, not if the page is waiting
            // for a blank, the feedback box or the chat (see lib/streaming-flow.ts)
            setIsTyping(isPaused && shouldTypeOnResume({ isWaitingForBlankFill, isWaitingForFeedback, hasActiveAccordion: activeAccordion !== null, isAtParagraphEnd: paragraphEndRef.current, isContentComplete }));
        }
    };
    
    // Clears all learner-visible state. Used by the Reset button and when moving to the next
    // question. It writes no log entry: only a real Reset click does (see handleReset).
    const resetStreamingState = () => {
        // Cancel an in-flight showAIAnswer loop and every pending timer so they stop writing state
        answerStreamTokenRef.current += 1;
        timers.clearAll();
        paragraphEndRef.current = false;
        typingClockRef.current = newTypingClock();
        typedCharsRef.current = 0;
        setIsStreamingAIAnswer(false);
        setIsTyping(false);
        setIsPaused(false);
        setIsStreamingSessionActive(false);
        setIsContentComplete(false);
        setCompletedContent([]);
        setCompletedParagraphs([]);
        setCurrentParagraph("");
        setDisplayedCurrentParagraph("");
        setTextPosition(0);
        setDisplayPosition(0);
        setIsWaitingForFeedback(false);
        setIsWaitingForBlankFill(false);
        setCurrentBlankAnswer(null);
        setUserInput("");
        setFeedbackMessage("");
        setBlankResponses([]);
        setActiveAccordion(null);
        setJustCompletedBlank(false);
        setShowAIOutput(false);
        setShowAIPrompt(false);
        setStreamedAIAnswer("");
    };

    const handleReset = () => {
    logButtonClick("reset_button_click", { questionId: currentQuestion?.id });
        resetStreamingState();
    };

    const handleParagraphFeedback = (understood: boolean) => {
    logButtonClick(understood ? "understand_button_click" : "dont_understand_button_click", { questionId: currentQuestion?.id, paragraph: currentParagraph });
        const newCompletedParagraph = (
            <ReactMarkdown key={`p-${textPosition}`} components={markdownComponents}>
                {currentParagraph}
            </ReactMarkdown>
        );

        const newAccordionData: ParagraphAccordion = {
            id: `acc-${textPosition}`,
            position: textPosition,
            chatMessages: [],
            paragraphContext: currentParagraph,
            userFeedback: understood ? "understood" : "did_not_understand",
        };

        if (understood) {
            const readOnlyFeedback = (
                <div key={newAccordionData.id} className="my-4">
                    <ChatAccordion 
                        accordionId={newAccordionData.id}
                        chatMessages={[]}
                        currentChatInput=""
                        setCurrentChatInput={() => {}}
                        onSubmit={() => {}}
                        isLoadingResponse={false}
                        isReadOnly={true}
                        userFeedback="understood"
                        isDimmed={true}
                        defaultClosed={true}
                    />
                </div>
            );
            setCompletedContent(prev => [...prev, newCompletedParagraph, readOnlyFeedback]);
            setCompletedParagraphs(prev => [...prev, currentParagraph]);
            setCurrentParagraph("");
            setDisplayPosition(0);
            setIsWaitingForFeedback(false);
            paragraphEndRef.current = false;
            if (textPosition >= aiText.length) {
                setIsContentComplete(true);
                timers.set(() => setShowAIPrompt(true), 500, "show-ai-prompt");
            } else if (!isPaused) {
                setIsTyping(true);
            }
        } else {
            setActiveAccordion(newAccordionData);
        }
    };
    
    const handleContinueAfterChat = () => {
        if (!activeAccordion) return;

        const newCompletedParagraph = (
            <ReactMarkdown key={`p-${textPosition}`} components={markdownComponents}>
                {currentParagraph}
            </ReactMarkdown>
        );
        
        const readOnlyFeedback = (
            <div key={activeAccordion.id} className="my-4">
                <ChatAccordion 
                    accordionId={activeAccordion.id}
                    chatMessages={activeAccordion.chatMessages}
                    currentChatInput=""
                    setCurrentChatInput={() => {}}
                    onSubmit={() => {}}
                    isLoadingResponse={false}
                    isReadOnly={true}
                    userFeedback={activeAccordion.userFeedback}
                    isDimmed={true}
                    defaultClosed={true}
                />
            </div>
        );

        setCompletedContent(prev => [...prev, newCompletedParagraph, readOnlyFeedback]);
        setCompletedParagraphs(prev => [...prev, currentParagraph]);
        setCurrentParagraph("");
        setDisplayPosition(0);
        setActiveAccordion(null);
        setIsWaitingForFeedback(false);
        paragraphEndRef.current = false;
        if (textPosition >= aiText.length) {
                setIsContentComplete(true);
                timers.set(() => setShowAIPrompt(true), 500, "show-ai-prompt");
            } else if (!isPaused) {
                setIsTyping(true);
            }
    };

    const handleUserInputSubmit = () => {
        if (!userInput.trim() || !currentBlankAnswer) return;
        const isCorrect = isBlankAnswerCorrect(userInput, currentBlankAnswer);
        
        logButtonClick("blank_answer_submit", {
            userAnswer: userInput.trim(),
            correctAnswer: currentBlankAnswer,
            isCorrect,
            position: textPosition,
            questionId: currentQuestion?.id
        });
        
        setBlankResponses(prev => [...prev, { userAnswer: userInput.trim(), correctAnswer: currentBlankAnswer, isCorrect, position: textPosition }]);
        setFeedbackMessage(isCorrect ? "✓ Correct! Well done!" : "✗ Incorrect. Try again next time!");
        
        const answerText = isCorrect
            ? `**${userInput.trim()}** ✓`
            : `**${userInput.trim()}** ✗ (Correct Answer: ${currentBlankAnswer})`;

        setCurrentParagraph(prev => prev + answerText);
        
        timers.set(() => {
            setIsWaitingForBlankFill(false);
            setFeedbackMessage("");
            setUserInput("");
            setCurrentBlankAnswer(null);
            setJustCompletedBlank(true); // This will trigger the display animation useEffect to resume typing
        }, FEEDBACK_DURATION_MS, "blank-feedback");
    };
    
    // --- API & Helper Functions ---
    const getChatResponseStream = async (userMessage: string, context: string, conversationHistory: { role: string; message: string }[], onChunk: (chunk: string) => void) => {
        const response = await fetch("/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: userMessage, context, type: "explanation_chat", conversationHistory }),
        });
        if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
        if (!response.body) throw new Error("No response body");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let aiText = "";
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            aiText += chunk;
            onChunk(aiText);
        }
        return aiText;
    };

    const handleChatSubmit = async (accordionId: string) => {
    if (!currentChatInput.trim() || isLoadingResponse || !activeAccordion) return;

    const userMessage = currentChatInput;
    setCurrentChatInput("");
    setIsLoadingResponse(true);

    // Compose context: question + completed paragraphs + current paragraph
    const completedParagraphsText = completedParagraphs.join("\n\n");
    const currentParagraphText = activeAccordion.paragraphContext;
    const questionText = currentQuestion?.question || "";
    const context = `Question: ${questionText}\n\nPrevious: ${completedParagraphsText}\n\nCurrent: ${currentParagraphText}`;

    const updatedAccordion = {
        ...activeAccordion,
        chatMessages: [...activeAccordion.chatMessages, { role: "user" as const, message: userMessage }, { role: "ai" as const, message: "" }]
    };
    setActiveAccordion(updatedAccordion);

    try {
        await getChatResponseStream(userMessage, context, activeAccordion.chatMessages, (streamedText) => {
            setActiveAccordion(prev => {
                if (!prev) return null;
                const updatedMessages = [...prev.chatMessages];
                updatedMessages[updatedMessages.length - 1] = { role: "ai", message: streamedText };
                return { ...prev, chatMessages: updatedMessages };
            });
        });
    } catch (error) {
        console.error("Chat error:", error);
        setActiveAccordion(prev => {
            if (!prev) return null;
            const updatedMessages = [...prev.chatMessages];
            updatedMessages[updatedMessages.length - 1] = { role: "ai", message: "Sorry, I couldn't process that. Please try again." };
            return { ...prev, chatMessages: updatedMessages };
        });
    } finally {
        setIsLoadingResponse(false);
    }
};
    
    const handleContinueFromAIOutput = () => {
        if (currentQuestionIndex < allQuestions.length - 1) {
            const nextIndex = currentQuestionIndex + 1;
            setCurrentQuestion(allQuestions[nextIndex]);
            setCurrentQuestionIndex(nextIndex);
            resetStreamingState();
        } else {
             alert("Congratulations! You've completed all questions!");
        }
    };
    
    const showAIAnswer = async () => {
        const token = ++answerStreamTokenRef.current;
    await logButtonClick("ok_ai_output_button_click", { questionId: currentQuestion?.id });
        if (answerStreamTokenRef.current !== token) return; // cancelled while the log request was in flight
        setShowAIPrompt(false);
        setShowAIOutput(true);
        setIsStreamingAIAnswer(true);
        const answer = currentQuestion?.answer || "";
        for (let i = 0; i <= answer.length; i++) {
            if (answerStreamTokenRef.current !== token) return; // reset, next question or unmount
            setStreamedAIAnswer(answer.slice(0, i));
            await new Promise(res => setTimeout(res, 15));
        }
        if (answerStreamTokenRef.current !== token) return;
        setIsStreamingAIAnswer(false);
    };

    const getButtonState = () => {
        if (isContentComplete) return { text: "Complete", color: "bg-emerald-500 hover:bg-emerald-600", disabled: true };
        if (!currentQuestion || isContentLoading) return { text: "Loading...", color: "bg-gray-500", disabled: true };
        if (!isStreamingSessionActive) return { text: "Start", color: "bg-blue-500 hover:bg-blue-600", disabled: false };
        if (isPaused) return { text: "Resume", color: "bg-emerald-500 hover:bg-emerald-600", disabled: false };
        return { text: "Pause", color: "bg-violet-500 hover:bg-violet-600", disabled: false };
    };
    const buttonState = getButtonState();

    if (isLoadingQuestions) {
        return (
            <div className="min-h-screen bg-black text-white flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
                    <div>Loading questions...</div>
                </div>
            </div>
        );
    }

    if (!currentQuestion) {
        return (
            <div className="min-h-screen bg-black text-white flex items-center justify-center">
                <div className="text-center">
                    <div className="text-red-400 text-xl mb-2">⚠️</div>
                    <div>No questions available.</div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-black text-white flex flex-col">
            {/* Logout button at top right */}
            <div className="w-full flex justify-end p-4">
              <button
                onClick={handleLogout}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-white font-semibold shadow transition-all"
              >
                Logout
              </button>
            </div>
            <div className="flex-1 max-w-6xl mx-auto w-full p-4">
                <h1 className="text-3xl font-bold mb-6 bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                    AI Thinking
                </h1>
                
                <div className="mb-6 bg-gradient-to-r from-slate-800/50 to-slate-700/50 rounded-xl p-6 border border-slate-600/50 backdrop-blur-sm">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full flex items-center justify-center">
                            <span className="text-white font-bold text-sm">Q</span>
                        </div>
                        <h2 className="text-xl font-semibold text-slate-200">Question</h2>
                    </div>
                    <div className="whitespace-pre-line text-lg text-white mb-3 leading-relaxed">
                        {currentQuestion.question}
                    </div>
                    <div className="flex items-center justify-between">
                        <p className="text-sm text-slate-400">
                            Question {currentQuestionIndex + 1} of {allQuestions.length}
                        </p>
                        <div className="flex gap-1">
                            {allQuestions.map((_, i) => (
                                <div key={i} className={`w-2 h-2 rounded-full ${i === currentQuestionIndex ? 'bg-blue-500' : i < currentQuestionIndex ? 'bg-green-500' : 'bg-slate-600'}`} />
                            ))}
                        </div>
                    </div>
                </div>

                <div className="mt-6">
                    <button onClick={handlePlayPause} disabled={buttonState.disabled} className={`${buttonState.color} ${buttonState.disabled ? 'opacity-50 cursor-not-allowed' : ''} text-white font-bold py-3 px-6 rounded-xl mr-3 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-105`}>
                        {buttonState.text}
                    </button>
                    <button onClick={handleReset} className="bg-slate-600 hover:bg-slate-700 text-white font-bold py-3 px-6 rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-105">
                        Reset
                    </button>
                </div>

                <div className="font-sans text-lg mt-6" aria-live="off" aria-busy={isTyping}>
                    {completedContent}

                    {displayedCurrentParagraph && <TypedText text={displayedCurrentParagraph} />}

                    {isWaitingForBlankFill && (
                        <ModernBlankInput
                            userInput={userInput}
                            setUserInput={setUserInput}
                            onSubmit={handleUserInputSubmit}
                            feedbackMessage={feedbackMessage}
                        />
                    )}
                    
                    {isWaitingForFeedback && !activeAccordion && !isWaitingForBlankFill && !justCompletedBlank && (
                        <div className="block mt-4 p-4 bg-slate-800/80 rounded-lg border border-slate-600/50 backdrop-blur-sm">
                            <div className="text-blue-300 mb-3 font-medium">Am I making sense?</div>
                            <div className="flex items-center space-x-4">
                                <button onClick={() => handleParagraphFeedback(true)} className="flex items-center px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg transition-colors text-white">
                                    <span className="text-xl mr-2">👍</span>
                                    <span>Yes, continue</span>
                                </button>
                                <button onClick={() => handleParagraphFeedback(false)} className="flex items-center px-4 py-2 bg-yellow-600 hover:bg-yellow-700 rounded-lg transition-colors text-white">
                                    <span className="text-xl mr-2">❓</span>
                                    <span>I don&apos;t understand</span>
                                </button>
                            </div>
                        </div>
                    )}

                    {activeAccordion && (
                        <ChatAccordion
                            accordionId={activeAccordion.id}
                            chatMessages={activeAccordion.chatMessages}
                            currentChatInput={currentChatInput}
                            setCurrentChatInput={setCurrentChatInput}
                            onSubmit={handleChatSubmit}
                            isLoadingResponse={isLoadingResponse}
                            isReadOnly={false}
                            userFeedback={activeAccordion.userFeedback}
                            onContinue={handleContinueAfterChat}
                            isDimmed={false}
                            defaultClosed={false}
                        />
                    )}

                    {showAIPrompt && !showAIOutput && (
                        <div className="flex flex-col items-center justify-center my-12">
                            <div className="bg-gradient-to-r from-emerald-900/60 to-teal-900/60 p-8 rounded-2xl border border-emerald-500/20 shadow-xl max-w-lg w-full text-center">
                                <h3 className="text-2xl font-bold text-emerald-200 mb-3">Now let&apos;s see what the AI responded with.</h3>
                                <button onClick={showAIAnswer} className="mt-4 px-8 py-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold rounded-xl transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105">
                                    Ok
                                </button>
                            </div>
                        </div>
                    )}

                    {showAIOutput && currentQuestion?.answer && (
                        <ModernAIOutputDisplay
                            answer={streamedAIAnswer}
                            onContinue={handleContinueFromAIOutput}
                            buttonText={currentQuestionIndex < allQuestions.length - 1 ? "Next Question" : "Finish"}
                            loading={isStreamingAIAnswer}
                            markdownComponents={markdownComponents}
                        />
                    )}

                    {/*{showAIOutput && currentQuestion?.answer && (
                        <PerformanceSummary
                            blankResponses={blankResponses}
                            isContentComplete={isContentComplete}
                        />
                    )}*/}
                </div>

                <div ref={bottomRef} />
            </div>
        </div>
    );
}

export default StreamingPage;