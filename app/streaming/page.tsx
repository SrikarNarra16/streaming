// app/streaming_old/page.tsx (FIXED - PROPER BLANK DETECTION THAT ACTUALLY WORKS)
"use client";

import React, { useEffect, useState, useRef } from "react";
import ReactMarkdown from "react-markdown";

import { BlankInput } from "@/components/streaming/BlankInput";
import { ParagraphFeedback } from "@/components/streaming/ParagraphFeedback";
import { PerformanceSummary } from "@/components/streaming/PerformanceSummary";
import { ChatAccordion } from "@/components/streaming/ChatAccordion";

// Question interface
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

// Helper interface for streaming segments
interface ThinkingSegment {
  text: string | null;
  isBlank: boolean;
  blankAnswer: string | null;
  newPosition?: number;
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

// Modern BlankInput Component
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

function StreamingPage() {
    // Question state
    const [allQuestions, setAllQuestions] = useState<Question[]>([]);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
    const [isLoadingQuestions, setIsLoadingQuestions] = useState(true);

    // Get AI text from current question
    const aiText = currentQuestion?.content || "";

    // Core streaming state
    const [isTyping, setIsTyping] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [isStreamingSessionActive, setIsStreamingSessionActive] = useState(false);
    const [isContentComplete, setIsContentComplete] = useState(false);
    
    // Content management - USING REFERENCE APPROACH
    const [completedContent, setCompletedContent] = useState<React.ReactNode[]>([]);
    const [completedParagraphs, setCompletedParagraphs] = useState<string[]>([]);
    const [revealedText, setRevealedText] = useState(""); // Like reference code
    const [currentPosition, setCurrentPosition] = useState(0); // Like reference code
    
    // Interactive states
    const [isWaitingForFeedback, setIsWaitingForFeedback] = useState(false);
    const [isWaitingForBlankFill, setIsWaitingForBlankFill] = useState(false);
    const [currentBlankAnswer, setCurrentBlankAnswer] = useState<string | null>(null);
    const [userInput, setUserInput] = useState("");
    const [feedbackMessage, setFeedbackMessage] = useState("");
    const [blankResponses, setBlankResponses] = useState<BlankResponse[]>([]);

    // Chat accordion state
    const [activeAccordion, setActiveAccordion] = useState<ParagraphAccordion | null>(null);
    const [currentChatInput, setCurrentChatInput] = useState("");
    const [isLoadingResponse, setIsLoadingResponse] = useState(false);

    // Fetch questions on mount
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

    // FIXED: Use the exact same logic as reference code
    function getNextSegment(charsToFetch: number): ThinkingSegment {
        if (currentPosition >= aiText.length) {
            return {
                text: null,
                isBlank: false,
                blankAnswer: null,
                newPosition: currentPosition,
            };
        }

        const remainingText = aiText.slice(currentPosition);
        const blankMatch = remainingText.match(/^BLANK\(([^)]+)\)/);

        if (blankMatch) {
            const blankAnswer = blankMatch[1];
            console.log("Found blank:", blankAnswer);
            console.log("New position after blank:", currentPosition + blankMatch[0].length);

            return {
                text: null,
                isBlank: true,
                blankAnswer,
                newPosition: currentPosition + blankMatch[0].length,
            };
        }

        let endIndex = remainingText.indexOf("BLANK(");
        if (endIndex === -1) {
            endIndex = remainingText.length;
        }

        const chunkSize = Math.min(charsToFetch, endIndex);
        const textChunk = remainingText.slice(0, chunkSize);

        return {
            text: textChunk,
            isBlank: false,
            blankAnswer: null,
            newPosition: currentPosition + chunkSize,
        };
    }

    // AI streaming function
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
        const currentText = revealedText;
        
        if (allCompletedText && currentText) {
            return `${allCompletedText}\n\n${currentText}`;
        } else if (allCompletedText) {
            return allCompletedText;
        } else if (currentText) {
            return currentText;
        }
        return "No context available";
    };

    // FIXED: Main typing effect using reference approach
    useEffect(() => {
        if (!isTyping || !currentQuestion) return;

        if (currentPosition >= aiText.length && !getNextSegment(1).isBlank) {
            setIsTyping(false);
            setIsContentComplete(true);
            return;
        }

        const intervalId = setInterval(() => {
            const segment = getNextSegment(CHARS_PER_TYPE_INTERVAL);

            if (segment.text) {
                console.log(`Revealing text: ${segment.text}`);

                const paragraphBreakIndex = segment.text.indexOf("\n\n");

                if (paragraphBreakIndex !== -1) {
                    const textUpToParagraph = segment.text.slice(0, paragraphBreakIndex + 2);
                    setRevealedText((prev) => prev + textUpToParagraph);
                    setCurrentPosition(currentPosition + textUpToParagraph.length);
                    setIsTyping(false);
                    setIsWaitingForFeedback(true);
                } else {
                    setRevealedText((prev) => prev + segment.text);
                    setCurrentPosition(segment.newPosition || currentPosition);
                }
            } else if (segment.isBlank) {
                setRevealedText((prev) => prev + `[${segment.blankAnswer}] `);
                setIsTyping(false);
                console.log(`Blank found: ${segment.blankAnswer}`);
                setCurrentPosition(segment.newPosition || currentPosition);
                setCurrentBlankAnswer(segment.blankAnswer);
                setIsWaitingForBlankFill(true);
            } else {
                setIsTyping(false);
                setIsContentComplete(true);
            }
        }, TYPING_INTERVAL_MS);

        return () => clearInterval(intervalId);
    }, [isTyping, currentPosition, currentQuestion]);

    // Event handlers
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
        setRevealedText("");
        setCurrentPosition(0);
        setIsWaitingForFeedback(false);
        setIsWaitingForBlankFill(false);
        setCurrentBlankAnswer(null);
        setUserInput("");
        setFeedbackMessage("");
        setBlankResponses([]);
        setActiveAccordion(null);
    };

    const handleParagraphFeedback = (understood: boolean) => {
        const newCompletedParagraph = (
            <ReactMarkdown key={`p-${currentPosition}`} components={markdownComponents}>
                {revealedText}
            </ReactMarkdown>
        );

        const newAccordionData: ParagraphAccordion = {
            id: `acc-${currentPosition}`,
            position: currentPosition,
            chatMessages: [],
            paragraphContext: revealedText,
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
            setCompletedParagraphs(prev => [...prev, revealedText]);
            setRevealedText("");
            setIsWaitingForFeedback(false);
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
            <ReactMarkdown key={`p-${currentPosition}`} components={markdownComponents}>
                {revealedText}
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
        setCompletedParagraphs(prev => [...prev, revealedText]);
        setRevealedText("");
        setActiveAccordion(null);
        setIsWaitingForFeedback(false);
        if (!isPaused) {
            setIsTyping(true);
        }
    };

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

    const handleUserInputSubmit = () => {
        if (!userInput.trim() || !currentBlankAnswer) return;

        const isCorrect = userInput.trim().toLowerCase() === currentBlankAnswer.toLowerCase();

        const blankResponse: BlankResponse = {
            userAnswer: userInput.trim(),
            correctAnswer: currentBlankAnswer,
            isCorrect,
            position: currentPosition - `BLANK(${currentBlankAnswer})`.length,
        };

        setBlankResponses((prev) => [...prev, blankResponse]);
        setFeedbackMessage(isCorrect ? "✓ Correct!" : "✗ Incorrect!");

        setTimeout(() => {
            setRevealedText((prev) => {
                const blankPlaceholder = `[${currentBlankAnswer}] `;
                const lastBlankIndex = prev.lastIndexOf(blankPlaceholder);

                if (lastBlankIndex !== -1) {
                    const beforeBlank = prev.slice(0, lastBlankIndex);
                    const afterBlank = prev.slice(lastBlankIndex + blankPlaceholder.length);

                    let replacement;
                    if (isCorrect) {
                        replacement = `**${userInput.trim()}** ✓`;
                    } else {
                        replacement = `**${userInput.trim()}** ✗ (Correct Answer: ${currentBlankAnswer})`;
                    }

                    return beforeBlank + replacement + afterBlank;
                }
                return prev;
            });

            setUserInput("");
            setFeedbackMessage("");
            setCurrentBlankAnswer(null);
            setIsWaitingForBlankFill(false);

            if (currentPosition < aiText.length) {
                setIsTyping(true);
            } else {
                const nextSegment = getNextSegment(1);
                if (nextSegment.isBlank) {
                    setIsTyping(true);
                } else {
                    setIsContentComplete(true);
                }
            }
        }, FEEDBACK_DURATION_MS);
    };

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

    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (bottomRef.current) {
            bottomRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [
        activeAccordion?.chatMessages,
        completedContent,
        revealedText,
        isContentComplete,
        isWaitingForBlankFill,
        isWaitingForFeedback,
    ]);

    // Loading states
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
                
                {/* Question Display */}
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

                    {revealedText && (
                         <ReactMarkdown components={markdownComponents}>
                            {revealedText}
                        </ReactMarkdown>
                    )}

                    {/* Modern Blank Input */}
                    {isWaitingForBlankFill && currentBlankAnswer && (
                        <ModernBlankInput
                            userInput={userInput}
                            setUserInput={setUserInput}
                            onSubmit={handleUserInputSubmit}
                            currentBlankAnswer={currentBlankAnswer}
                            feedbackMessage={feedbackMessage}
                        />
                    )}
                    
                    {isWaitingForFeedback && !activeAccordion && (
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
                </div>
                
                <PerformanceSummary
                    blankResponses={blankResponses}
                    isContentComplete={isContentComplete}
                />

                <div ref={bottomRef} />
            </div>
        </div>
    );
}

export default StreamingPage;
