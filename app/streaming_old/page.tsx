// app/streaming_old/page.tsx (PRODUCTION READY - AI INTEGRATED WITH DB FETCHING)
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
            onChunk(aiText); // Pass the accumulated text, not just the chunk
        }
        return aiText;
    }

    // Helper function to get current context
    const getCurrentParagraphContext = () => {
        const questionText = currentQuestion?.question || "";
        const allCompletedText = completedParagraphs.join("\n\n");
        const currentText = currentParagraph || displayedCurrentParagraph;

        let context = "";
        if (questionText) context += `Question: ${questionText}\n\n`;
        if (allCompletedText && currentText) {
            context += `${allCompletedText}\n\n${currentText}`;
        } else if (allCompletedText) {
            context += allCompletedText;
        } else if (currentText) {
            context += currentText;
        }
        if (!context) context = "No context available";
        return context;
    };

    // --- STREAMING LOGIC ---
    useEffect(() => {
        if (!isTyping || isPaused || aiText.length === 0 || textPosition >= aiText.length) {
            if (aiText.length > 0 && textPosition >= aiText.length) {
                setIsContentComplete(true);
                setIsStreamingSessionActive(false);
                setIsTyping(false);
            }
            return;
        }

        const intervalId = setInterval(() => {
            const remainingText = aiText.slice(textPosition);
            
            const blankMatch = remainingText.match(/^BLANK\(([^)]+)\)/);
            if (blankMatch) {
                const answer = blankMatch[1];
                const fullBlankTag = blankMatch[0];
                setCurrentBlankAnswer(answer);
                setIsTyping(false);
                setIsWaitingForBlankFill(true);
                setTextPosition(prev => prev + fullBlankTag.length);
                return;
            }

            const paragraphBreakIndex = remainingText.indexOf("\n\n");
            let chunk = "";
            
            if (paragraphBreakIndex !== -1) {
                chunk = remainingText.slice(0, paragraphBreakIndex);
                setCurrentParagraph(prev => prev + chunk);
                setTextPosition(prev => prev + chunk.length + 2);
                setIsTyping(false);
                return;
            } else {
                chunk = remainingText.slice(0, CHARS_PER_TYPE_INTERVAL);
                setCurrentParagraph(prev => prev + chunk);
                setTextPosition(prev => prev + chunk.length);
            }
        }, TYPING_INTERVAL_MS);

        return () => clearInterval(intervalId);
    }, [isTyping, isPaused, textPosition, aiText]);

    // --- DISPLAY ANIMATION ---
    useEffect(() => {
        if (isPaused || displayPosition >= currentParagraph.length) {
            if (displayPosition >= currentParagraph.length && !isTyping && currentParagraph.length > 0) {
                setTimeout(() => {
                    setIsWaitingForFeedback(true);
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
    }, [currentParagraph, displayPosition, isPaused, isTyping]);

    useEffect(() => {
        if (currentParagraph === "") {
            setDisplayPosition(0);
            setDisplayedCurrentParagraph("");
        }
    }, [currentParagraph]);

    // --- EVENT HANDLERS ---
    const handlePlayPause = () => {
        if (!currentQuestion) return; // NEW: Don't allow if no question loaded

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
        if (!isPaused) {
            setIsTyping(true);
        }
    };

    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      if (bottomRef.current) {
        bottomRef.current.scrollIntoView({ behavior: "smooth" });
      }
    }, [
      // Add all dependencies that change when new content is added
      activeAccordion?.chatMessages,
      completedContent,
      currentParagraph,
      displayedCurrentParagraph,
      isContentComplete,
      isWaitingForBlankFill,
      isWaitingForFeedback,
    ]);

    // FIXED: Chat submit handler
    const handleChatSubmit = async (accordionId: string) => {
        if (!currentChatInput.trim() || isLoadingResponse || !activeAccordion) return;

        const userMessage = currentChatInput;
        setCurrentChatInput("");
        setIsLoadingResponse(true);

        // Get context - use the accordion's context or current context
        let context = activeAccordion.paragraphContext;
        if (!context || context.trim() === "" || context === "Context placeholder") {
            context = getCurrentParagraphContext();
        }

        console.log("Using context for chat:", context.slice(0, 200) + "...");

        // Get conversation history
        const conversationHistory = activeAccordion.chatMessages || [];

        // Add user message immediately
        setActiveAccordion(prev => prev ? {
            ...prev,
            chatMessages: [...prev.chatMessages, { role: "user", message: userMessage }]
        } : null);

        try {
            // Add placeholder AI message for streaming
            setActiveAccordion(prev => prev ? {
                ...prev,
                chatMessages: [...prev.chatMessages, { role: "ai", message: "" }]
            } : null);

            // Stream AI response
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
        
        setBlankResponses(prev => [...prev, { userAnswer: userInput.trim(), correctAnswer: currentBlankAnswer, isCorrect, position: textPosition }]);
        
        setFeedbackMessage(isCorrect ? "✓ Correct!" : "✗ Incorrect!");
        
        const answerText = isCorrect
            ? `**${userInput.trim()}** ✓`
            : `**${userInput.trim()}** ✗ (Correct Answer: ${currentBlankAnswer})`;

        setCurrentParagraph(prev => prev + answerText);
        
        setTimeout(() => {
            setIsWaitingForBlankFill(false);
            setFeedbackMessage("");
            setUserInput("");
            setCurrentBlankAnswer(null);
            if (!isPaused) {
                setIsTyping(true);
            }
        }, FEEDBACK_DURATION_MS);
    };

    const getButtonState = () => {
        if (isContentComplete) {
            return { text: "Complete", color: "bg-emerald-500 hover:bg-emerald-600", disabled: true };
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
                <div>Loading questions...</div>
            </div>
        );
    }

    if (!currentQuestion) {
        return (
            <div className="min-h-screen bg-black text-white flex items-center justify-center">
                <div>No questions available</div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-black text-white p-8">
            <div className="max-w-6xl mx-auto">
                <h1 className="text-3xl font-bold mb-6">AI Thinking</h1>
                
                {/* NEW: Question Display */}
                <div className="mb-6 bg-gray-800 rounded-lg p-4">
                    <h2 className="text-xl font-semibold mb-2">Question</h2>
                    <div className="whitespace-pre-line question-text text-lg text-white mb-2">
                        {currentQuestion.question}
                    </div>
                    <p className="text-sm text-gray-400 mt-1">
                        Question {currentQuestionIndex + 1} of {allQuestions.length}
                    </p>
                </div>

                <div className="mt-6">
                    <button 
                        onClick={handlePlayPause} 
                        disabled={buttonState.disabled}
                        className={`${buttonState.color} ${buttonState.disabled ? 'opacity-50 cursor-not-allowed' : ''} text-white font-bold py-2 px-4 rounded-lg mr-2 transition-all duration-200 shadow-lg hover:shadow-xl`}
                    >
                        {buttonState.text}
                    </button>
                    <button 
                        onClick={handleReset} 
                        className="bg-slate-600 hover:bg-slate-700 text-white font-bold py-2 px-4 rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl"
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

                    {isWaitingForBlankFill && currentBlankAnswer && (
                        <BlankInput
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
