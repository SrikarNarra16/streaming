"use client";

import React, { useEffect, useState, useRef } from "react";
import ReactMarkdown from "react-markdown";

import { BlankInput } from "@/components/streaming/BlankInput";
import { ParagraphFeedback } from "@/components/streaming/ParagraphFeedback";
import { PerformanceSummary } from "@/components/streaming/PerformanceSummary";
import { ChatAccordion } from "@/components/streaming/ChatAccordion";

// NEW: Question interface
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
  
const TYPING_INTERVAL_MS = 20;
const CHARS_PER_TYPE_INTERVAL = 3;
const FEEDBACK_DURATION_MS = 1000;

const markdownComponents = {
    p: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => <p className="mb-4 leading-relaxed" {...props}>{children}</p>,
    code: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => <code className="bg-gray-700 px-2 py-1 rounded text-yellow-300 font-mono text-sm" {...props}>{children}</code>,
    pre: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => <pre className="bg-gray-800 p-4 rounded mt-2 mb-4 overflow-x-auto border border-gray-600" {...props}><code className="text-green-300 font-mono text-sm">{children}</code></pre>,
    strong: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => {
        const text = children?.toString() || "";
        if (text.includes("✓")) return <span className="font-bold text-green-400 bg-green-900/30 px-2 py-1 rounded" {...props}>{children}</span>;
        if (text.includes("✗")) return <span className="font-bold text-red-400 bg-red-900/30 px-2 py-1 rounded" {...props}>{children}</span>;
        return <strong className="font-bold text-blue-300" {...props}>{children}</strong>;
    },
};

// MODERN: Enhanced BlankInput Component with better styling
function ModernBlankInput({ 
    userInput, 
    setUserInput, 
    onSubmit, 
    currentBlankAnswer, 
    feedbackMessage 
}: {
    userInput: string;
    setUserInput: (value: string) => void;
    onSubmit: () => void;
    currentBlankAnswer: string;
    feedbackMessage: string;
}) {
    return (
        <div className="my-6 p-6 bg-gradient-to-r from-blue-900/20 to-purple-900/20 border border-blue-500/30 rounded-xl backdrop-blur-sm">
            <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
                    <span className="text-white font-bold text-sm">?</span>
                </div>
                <h3 className="text-lg font-semibold text-blue-300">Fill in the blank</h3>
            </div>
            
            <div className="space-y-4">
                <div className="flex gap-3">
                    <input
                        type="text"
                        value={userInput}
                        onChange={(e) => setUserInput(e.target.value)}
                        onKeyPress={(e) => e.key === "Enter" && onSubmit()}
                        placeholder="Type your answer here..."
                        className="flex-1 px-4 py-3 bg-slate-800/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                        autoFocus
                    />
                    <button
                        onClick={onSubmit}
                        disabled={!userInput.trim()}
                        className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:opacity-50 text-white font-medium rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl"
                    >
                        Submit
                    </button>
                </div>
                
                {feedbackMessage && (
                    <div className={`p-3 rounded-lg text-center font-medium ${
                        feedbackMessage.includes("✓") 
                            ? "bg-green-900/30 text-green-300 border border-green-500/30" 
                            : "bg-red-900/30 text-red-300 border border-red-500/30"
                    }`}>
                        {feedbackMessage}
                    </div>
                )}
                
                <div className="text-sm text-slate-400 text-center">
                    💡 Hint: Expected answer length is approximately {currentBlankAnswer?.length || 0} characters
                </div>
            </div>
        </div>
    );
}

// NEW: Modern AI Output Display Component
function ModernAIOutputDisplay({ 
    answer, 
    onContinue,
    buttonText = "Continue Learning",
    loading = false
}: {
    answer: string;
    onContinue: () => void;
    buttonText?: string;
    loading?: boolean;
}) {
    return (
        <div className="my-8 p-8 bg-gradient-to-br from-emerald-900/30 to-teal-900/30 border border-emerald-500/40 rounded-2xl backdrop-blur-sm shadow-2xl">
            <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full flex items-center justify-center shadow-lg">
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                </div>
                <div>
                    <h3 className="text-2xl font-bold text-emerald-300 mb-1">Now let's see the AI output!</h3>
                    <p className="text-emerald-200/80">Here's the complete solution from our AI system</p>
                </div>
            </div>
            
            <div className="bg-slate-900/50 rounded-xl p-6 mb-6 border border-slate-700/50">
                <div className="flex items-center gap-2 mb-4">
                    <div className="w-3 h-3 bg-emerald-500 rounded-full animate-pulse"></div>
                    <span className="text-sm font-medium text-emerald-400">AI Generated Answer</span>
                </div>
                <div className="text-white text-lg leading-relaxed whitespace-pre-line min-h-[48px]">
                    <ReactMarkdown components={markdownComponents}>
                        {answer}
                    </ReactMarkdown>
                    {loading && (
                        <span className="ml-2 animate-pulse text-emerald-400">|</span>
                    )}
                </div>
            </div>
            
            <div className="flex justify-center">
                <button
                    onClick={onContinue}
                    disabled={loading}
                    className={`px-8 py-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold rounded-xl transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105 flex items-center gap-3 ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                    <span>{buttonText}</span>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                </button>
            </div>
        </div>
    );
}

function StreamingPage() {
    // NEW: Question state
    const [allQuestions, setAllQuestions] = useState<Question[]>([]);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
    const [isLoadingQuestions, setIsLoadingQuestions] = useState(true);

    // MODIFIED: Get AI text from current question instead of hardcoded
    const aiText = currentQuestion?.content || "";

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
    
    // NEW: Track if we just completed a blank to skip feedback
    const [justCompletedBlank, setJustCompletedBlank] = useState(false);
    
    // NEW: AI Output display state
    const [showAIOutput, setShowAIOutput] = useState(false);
    // NEW: Show modern prompt before AI output
    const [showAIPrompt, setShowAIPrompt] = useState(false);
    // NEW: AI answer streaming state
    const [streamedAIAnswer, setStreamedAIAnswer] = useState("");
    const [isStreamingAIAnswer, setIsStreamingAIAnswer] = useState(false);

    // Chat accordion state
    const [activeAccordion, setActiveAccordion] = useState<ParagraphAccordion | null>(null);
    const [currentChatInput, setCurrentChatInput] = useState("");
    const [isLoadingResponse, setIsLoadingResponse] = useState(false);

    // NEW: Fetch all questions on component mount
    useEffect(() => {
        const fetchQuestions = async () => {
            setIsLoadingQuestions(true);
            try {
                const response = await fetch("/api/questions");
                if (!response.ok) {
                    throw new Error("Failed to fetch questions");
                }
                const data = await response.json();

                setAllQuestions(data.questions);

                // Auto-load first question if available
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

    // REMOVED: Show AI output prompt automatically on content complete
    // We'll now trigger the prompt only after user response, not after streaming.
    // useEffect(() => {
    //     if (isContentComplete && !showAIOutput && !showAIPrompt) {
    //         setTimeout(() => {
    //             setShowAIPrompt(true);
    //         }, 1000); // Show after 1 second delay
    //     }
    // }, [isContentComplete, showAIOutput, showAIPrompt]);

    // AI Agent Call - Fixed streaming function
    async function getChatResponseStream(
        userMessage: string, 
        context: string, 
        conversationHistory: Array<{ role: "user" | "ai"; message: string }>, 
        onChunk: (chunk: string) => void
    ) {
        const response = await fetch("/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                prompt: userMessage, 
                context, 
                type: "explanation_chat", 
                conversationHistory 
            }),
        });

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
    }

    // Helper function to get current context
    const getCurrentParagraphContext = () => {
        const allCompletedText = completedParagraphs.join("\n\n");
        const currentText = currentParagraph || displayedCurrentParagraph;
        
        if (allCompletedText && currentText) {
            return `${allCompletedText}\n\n${currentText}`;
        } else if (allCompletedText) {
            return allCompletedText;
        } else if (currentText) {
            return currentText;
        }
        return "No context available";
    };

    // --- STREAMING LOGIC --- [FIXED BLANK DETECTION]
    useEffect(() => {
        if (!isTyping || isPaused || textPosition >= aiText.length) {
            if (textPosition >= aiText.length && aiText.length > 0) {
                setIsContentComplete(true);
                setIsStreamingSessionActive(false);
                setIsTyping(false);
            }
            return;
        }

        const intervalId = setInterval(() => {
            const remainingText = aiText.slice(textPosition);
            
            // FIXED: Better BLANK detection - check at the start of remaining text
            const blankMatch = remainingText.match(/^BLANK\(([^)]+)\)/i);
            if (blankMatch) {
                const answer = blankMatch[1];
                const fullBlankTag = blankMatch[0];
                
                console.log("BLANK detected:", { answer, fullBlankTag, textPosition });
                
                // Set up for user input - DON'T add the BLANK text to currentParagraph
                setCurrentBlankAnswer(answer);
                setIsTyping(false);
                setIsWaitingForBlankFill(true);
                
                // Move position past the BLANK tag WITHOUT adding it to the paragraph
                setTextPosition(prev => prev + fullBlankTag.length);
                return;
            }

            // Check for paragraph breaks
            const paragraphBreakIndex = remainingText.indexOf("\n\n");
            let chunk = "";
            
            if (paragraphBreakIndex !== -1 && paragraphBreakIndex < CHARS_PER_TYPE_INTERVAL) {
                // Found paragraph break within next chunk
                chunk = remainingText.slice(0, paragraphBreakIndex);
                setCurrentParagraph(prev => prev + chunk);
                setTextPosition(prev => prev + chunk.length + 2); // +2 for \n\n
                setIsTyping(false);
                return;
            } else {
                // Process normal text in chunks
                chunk = remainingText.slice(0, CHARS_PER_TYPE_INTERVAL);
                setCurrentParagraph(prev => prev + chunk);
                setTextPosition(prev => prev + chunk.length);
            }
        }, TYPING_INTERVAL_MS);

        return () => clearInterval(intervalId);
    }, [isTyping, isPaused, textPosition, aiText]);

    // --- DISPLAY ANIMATION --- [FIXED TO SKIP FEEDBACK AFTER BLANK]
    useEffect(() => {
        if (isPaused || displayPosition >= currentParagraph.length) {
            if (displayPosition >= currentParagraph.length && !isTyping && currentParagraph.length > 0) {
                setTimeout(() => {
                    // FIXED: Skip feedback if we just completed a blank
                    if (justCompletedBlank) {
                        setJustCompletedBlank(false);
                        // Continue streaming immediately
                        if (!isPaused) {
                            setIsTyping(true);
                        }
                    } else {
                        setIsWaitingForFeedback(true);
                    }
                }, 200);
            }
            return;
        }

        const intervalId = setInterval(() => {
            setDisplayPosition(prev => {
                const newPos = prev + CHARS_PER_TYPE_INTERVAL;
                setDisplayedCurrentParagraph(currentParagraph.slice(0, newPos));
                return newPos;
            });
        }, TYPING_INTERVAL_MS);

        return () => clearInterval(intervalId);
    }, [currentParagraph, displayPosition, isPaused, isTyping, justCompletedBlank]);

    useEffect(() => {
        if (currentParagraph === "") {
            setDisplayPosition(0);
            setDisplayedCurrentParagraph("");
        }
    }, [currentParagraph]);

    // --- EVENT HANDLERS ---
    const handlePlayPause = () => {
        if (!currentQuestion) return;

        if (!isStreamingSessionActive && !isContentComplete) {
            setIsStreamingSessionActive(true);
            setIsTyping(true);
            setIsPaused(false);
        } else if (isStreamingSessionActive && !isContentComplete) {
            setIsPaused(!isPaused);
            if (isPaused) {
                if (!isWaitingForFeedback && !isWaitingForBlankFill && !activeAccordion) {
                    setIsTyping(true);
                }
            } else {
                setIsTyping(false);
            }
        }
    };
    
    const handleReset = () => {
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
        setShowAIOutput(false); // NEW: Reset AI output display
    };

    const handleParagraphFeedback = (understood: boolean) => {
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
                        chatMessages={newAccordionData.chatMessages}
                        currentChatInput=""
                        setCurrentChatInput={() => {}}
                        onSubmit={() => {}}
                        isLoadingResponse={false}
                        isReadOnly={true}
                        userFeedback={newAccordionData.userFeedback}
                        isDimmed={true}
                        defaultClosed={true}
                    />
                </div>
            );
            setCompletedContent(prev => [...prev, newCompletedParagraph, readOnlyFeedback]);
            setCompletedParagraphs(prev => [...prev, currentParagraph]);
            setCurrentParagraph("");
            setDisplayedCurrentParagraph("");
            setDisplayPosition(0);
            setIsWaitingForFeedback(false);
            if (isContentComplete && !showAIOutput && !showAIPrompt) {
                setTimeout(() => setShowAIPrompt(true), 500);
            }
            if (!isPaused) {
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
        setDisplayedCurrentParagraph("");
        setDisplayPosition(0);
        setActiveAccordion(null);
        setIsWaitingForFeedback(false);
        // Show the AI prompt after chat, if content is complete
        if (isContentComplete && !showAIOutput && !showAIPrompt) {
            setTimeout(() => setShowAIPrompt(true), 500);
        }
        if (!isPaused) {
            setIsTyping(true);
        }
    };

    // NEW: Handle continue from AI output
    const handleContinueFromAIOutput = () => {
        // Move to next question or show completion
        if (currentQuestionIndex < allQuestions.length - 1) {
            const nextQuestion = allQuestions[currentQuestionIndex + 1];
            setCurrentQuestion(nextQuestion);
            setCurrentQuestionIndex(prev => prev + 1);
            
            // Reset all states for new question
            handleReset();
        } else {
            // All questions completed
            alert("Congratulations! You've completed all questions!");
        }
    };

    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      if (bottomRef.current) {
        bottomRef.current.scrollIntoView({ behavior: "smooth" });
      }
    }, [
      activeAccordion?.chatMessages,
      completedContent,
      currentParagraph,
      displayedCurrentParagraph,
      isContentComplete,
      isWaitingForBlankFill,
      isWaitingForFeedback,
      showAIOutput,
    ]);

    const handleChatSubmit = async (accordionId: string) => {
        if (!currentChatInput.trim() || isLoadingResponse || !activeAccordion) return;

        const userMessage = currentChatInput;
        setCurrentChatInput("");
        setIsLoadingResponse(true);

        let context = activeAccordion.paragraphContext;
        if (!context || context.trim() === "" || context === "Context placeholder") {
            context = getCurrentParagraphContext();
        }

        const conversationHistory = activeAccordion.chatMessages || [];

        setActiveAccordion(prev => prev ? {
            ...prev,
            chatMessages: [...prev.chatMessages, { role: "user", message: userMessage }]
        } : null);

        try {
            setActiveAccordion(prev => prev ? {
                ...prev,
                chatMessages: [...prev.chatMessages, { role: "ai", message: "" }]
            } : null);

            await getChatResponseStream(
                userMessage,
                context,
                conversationHistory,
                (streamedText: string) => {
                    setActiveAccordion(prev => {
                        if (!prev) return null;
                        const updatedMessages = [...prev.chatMessages];
                        const lastMessageIndex = updatedMessages.length - 1;
                        if (lastMessageIndex >= 0 && updatedMessages[lastMessageIndex].role === "ai") {
                            updatedMessages[lastMessageIndex] = {
                                ...updatedMessages[lastMessageIndex],
                                message: streamedText
                            };
                        }
                        return { ...prev, chatMessages: updatedMessages };
                    });
                }
            );
        } catch (error) {
            console.error("Chat error:", error);
            setActiveAccordion(prev => {
                if (!prev) return null;
                const updatedMessages = [...prev.chatMessages];
                const lastMessageIndex = updatedMessages.length - 1;
                if (lastMessageIndex >= 0 && updatedMessages[lastMessageIndex].role === "ai") {
                    updatedMessages[lastMessageIndex] = {
                        ...updatedMessages[lastMessageIndex],
                        message: "Sorry, I couldn't process your question right now. Please try again."
                    };
                }
                return { ...prev, chatMessages: updatedMessages };
            });
        } finally {
            setIsLoadingResponse(false);
        }
    };

    // ENHANCED: Modern blank input submit handler [FIXED TO SKIP FEEDBACK]
    const handleUserInputSubmit = () => {
        if (!userInput.trim() || !currentBlankAnswer) return;
        const isCorrect = userInput.trim().toLowerCase() === currentBlankAnswer.toLowerCase();
        
        setBlankResponses(prev => [...prev, { 
            userAnswer: userInput.trim(), 
            correctAnswer: currentBlankAnswer, 
            isCorrect, 
            position: textPosition 
        }]);
        
        setFeedbackMessage(isCorrect ? "✓ Correct! Well done!" : "✗ Incorrect. Try again next time!");
        
        // Add the user's answer to the paragraph with feedback
        const answerText = isCorrect
            ? `**${userInput.trim()}** ✓`
            : `**${userInput.trim()}** ✗ (Correct Answer: ${currentBlankAnswer})`;

        setCurrentParagraph(prev => prev + answerText);
        
        setTimeout(() => {
            setIsWaitingForBlankFill(false);
            setFeedbackMessage("");
            setUserInput("");
            setCurrentBlankAnswer(null);
            setJustCompletedBlank(true); // NEW: Set flag to skip feedback
            // Show the AI prompt after blank response, if content is complete
            if (isContentComplete && !showAIOutput && !showAIPrompt) {
                setTimeout(() => setShowAIPrompt(true), 500);
            }
            if (!isPaused) {
                setIsTyping(true);
            }
        }, FEEDBACK_DURATION_MS);
    };

    // FIXED: Button state logic
    const getButtonState = () => {
        if (isContentComplete && aiText.length > 0) {
            return { text: "Complete", color: "bg-emerald-500 hover:bg-emerald-600", disabled: true };
        }
        
        if (!currentQuestion || aiText.length === 0) {
            return { text: "Loading...", color: "bg-gray-500", disabled: true };
        }
        
        if (!isStreamingSessionActive) {
            return { text: "Start", color: "bg-blue-500 hover:bg-blue-600", disabled: false };
        }
        
        if (isPaused) {
            return { text: "Resume", color: "bg-emerald-500 hover:bg-emerald-600", disabled: false };
        }
        
        return { text: "Pause", color: "bg-violet-500 hover:bg-violet-600", disabled: false };
    };

    const buttonState = getButtonState();

    // NEW: Loading and error states
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
                    <div>No questions available</div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-black text-white p-8">
            <div className="max-w-6xl mx-auto">
                <h1 className="text-3xl font-bold mb-6 bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                    AI Thinking
                </h1>
                
                {/* NEW: Modern Question Display */}
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
                            {Array.from({ length: allQuestions.length }, (_, i) => (
                                <div
                                    key={i}
                                    className={`w-2 h-2 rounded-full ${
                                        i === currentQuestionIndex 
                                            ? 'bg-blue-500' 
                                            : i < currentQuestionIndex 
                                                ? 'bg-green-500' 
                                                : 'bg-slate-600'
                                    }`}
                                />
                            ))}
                        </div>
                    </div>
                </div>

                <div className="mt-6">
                    <button 
                        onClick={handlePlayPause} 
                        disabled={buttonState.disabled}
                        className={`${buttonState.color} ${buttonState.disabled ? 'opacity-50 cursor-not-allowed' : ''} text-white font-bold py-3 px-6 rounded-xl mr-3 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-105`}
                    >
                        {buttonState.text}
                    </button>
                    <button 
                        onClick={handleReset} 
                        className="bg-slate-600 hover:bg-slate-700 text-white font-bold py-3 px-6 rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-105"
                    >
                        Reset
                    </button>
                </div>

                <div className="font-sans text-lg mt-6">
                    {completedContent}

                    {displayedCurrentParagraph && (
                         <ReactMarkdown components={markdownComponents}>
                            {displayedCurrentParagraph}
                        </ReactMarkdown>
                    )}

                    {/* ENHANCED: Modern Blank Input - This should show when BLANK is detected */}
                    {isWaitingForBlankFill && currentBlankAnswer && (
                        <ModernBlankInput
                            userInput={userInput}
                            setUserInput={setUserInput}
                            onSubmit={handleUserInputSubmit}
                            currentBlankAnswer={currentBlankAnswer}
                            feedbackMessage={feedbackMessage}
                        />
                    )}
                    
                    {/* FIXED: Only show feedback if not waiting for blank and didn't just complete blank */}
                    {isWaitingForFeedback && !activeAccordion && !isWaitingForBlankFill && !justCompletedBlank && (
                        <ParagraphFeedback
                            onFeedback={handleParagraphFeedback}
                            currentAccordionId={null} 
                            feedbackMessage={""} 
                            onChatSubmit={()=>{}} 
                            currentChatInput="" 
                            setCurrentChatInput={()=>{}} 
                            isLoadingResponse={false} 
                            onContinueAfterChat={()=>{}} 
                            chatMessages={[]}
                        />
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

                    {/* MODERN PROMPT: Show after 'Am I making sense?' before AI answer */}
                    {showAIPrompt && !showAIOutput && (
                        <div className="flex flex-col items-center justify-center my-12">
                            <div className="bg-gradient-to-r from-emerald-900/60 to-teal-900/60 p-8 rounded-2xl border border-emerald-500/20 shadow-xl max-w-lg w-full text-center">
                                <h3 className="text-2xl font-bold text-emerald-200 mb-3">Now let's see what the AI thinks.</h3>
                                <button
                                    onClick={async () => {
                                        setShowAIPrompt(false);
                                        setShowAIOutput(true);
                                        setStreamedAIAnswer("");
                                        setIsStreamingAIAnswer(true);
                                        // Simulate streaming the AI answer character by character
                                        const answer = currentQuestion?.answer || "";
                                        for (let i = 1; i <= answer.length; i++) {
                                            setStreamedAIAnswer(answer.slice(0, i));
                                            await new Promise(res => setTimeout(res, 15));
                                        }
                                        setIsStreamingAIAnswer(false);
                                    }}
                                    className="mt-4 px-8 py-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold rounded-xl transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105"
                                >
                                    Ok
                                </button>
                            </div>
                        </div>
                    )}

                    {/* NEW: Modern AI Output Display - Shows after Ok click */}
                    {showAIOutput && currentQuestion?.answer && (
                        <ModernAIOutputDisplay
                            answer={streamedAIAnswer}
                            onContinue={handleContinueFromAIOutput}
                            buttonText={currentQuestionIndex < allQuestions.length - 1 ? "Next Question" : "Finish"}
                            loading={isStreamingAIAnswer}
                        />
                    )}

                    {/* Show PerformanceSummary only after last question's AI answer */}
                    {showAIOutput && currentQuestionIndex === allQuestions.length - 1 && (
                        <PerformanceSummary
                            blankResponses={blankResponses}
                            isContentComplete={isContentComplete}
                        />
                    )}
                </div>

                <div ref={bottomRef} />
            </div>
        </div>
    );
}

export default StreamingPage;
