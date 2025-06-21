"use client";

// ---------------------------------------------------------------------------

// TODO: Logging, Login, and DB (DONE)
// Add question on the top and to the chat (DONE)
// Add conversation history to the chat
// After each paragraph answer of the user to the feedback readonly
// Make more prominent: 3 ✗ (Correct Answer: 6)
// After thinking show the actual AI response

// ---------------------------------------------------------------------------
import React, { useEffect, useRef, useState } from "react";
import { animate, useMotionValue } from "framer-motion";

import { BlankInput } from "@/components/streaming/BlankInput";
import { ParagraphFeedback } from "@/components/streaming/ParagraphFeedback";
import { PerformanceSummary } from "@/components/streaming/PerformanceSummary";
import { TextRenderer } from "@/components/streaming/TextRenderer";

interface Question {
  id: number;
  question: string;
  content: string;
}

interface ThinkingSegment {
  text: string | null;
  isBlank: boolean;
  blankAnswer: string | null;
  newPosition?: number;
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

const TYPING_INTERVAL_MS = 100;
const CHARS_PER_TYPE_INTERVAL = 30;
const ANIMATION_CHARS_PER_SECOND = 30;
const FEEDBACK_DURATION_MS = 1500;

function StreamingPage() {
  // Question state
  const [allQuestions, setAllQuestions] = useState<Question[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [isLoadingQuestions, setIsLoadingQuestions] = useState(true);

  // Get current AI text from question
  const aiText = currentQuestion?.content || "";

  // Main state
  const [currentPosition, setCurrentPosition] = useState(0);
  const [revealedText, setRevealedText] = useState("");
  const [isTyping, setIsTyping] = useState(false);

  // Blank states
  const [isWaitingForBlankFill, setIsWaitingForBlankFill] = useState(false);
  const [userInput, setUserInput] = useState("");
  const [currentBlankAnswer, setCurrentBlankAnswer] = useState<string | null>(
    null
  );
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [isPreparingForBlank, setIsPreparingForBlank] = useState(false);

  // Paragraph feedback states
  const [isWaitingForParagraphFeedback, setIsWaitingForParagraphFeedback] =
    useState(false);
  const [paragraphFeedbackMessage, setParagraphFeedbackMessage] = useState("");

  // Accordion states
  const [paragraphAccordions, setParagraphAccordions] = useState<
    ParagraphAccordion[]
  >([]);
  const [currentAccordionId, setCurrentAccordionId] = useState<string | null>(
    null
  );
  const [currentChatInput, setCurrentChatInput] = useState("");
  const [isLoadingResponse, setIsLoadingResponse] = useState(false);

  // Performance tracking
  const [blankResponses, setBlankResponses] = useState<BlankResponse[]>([]);
  const [isContentComplete, setIsContentComplete] = useState(false);

  // Fetch all questions on component mount
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

  // Helper functions
  const getCurrentParagraphContext = (): string => {
    const fullContext = aiText.slice(0, currentPosition).trim();
    console.log("Generated context:", fullContext);
    return fullContext || "No context available";
  };

  const getChatResponse = async (
    userMessage: string,
    context: string,
    conversationHistory: Array<{ role: "user" | "ai"; message: string }> = []
  ): Promise<string> => {
    console.log("Context for chat:", context);
    console.log("Conversation history:", conversationHistory);

    if (!context || context.trim() === "") {
      console.warn("Empty context provided, using fallback");
      context = "General programming question";
    }

    // Convert conversation history to the format expected by the API
    const apiConversationHistory = conversationHistory.map((msg) => ({
      role: msg.role === "ai" ? "assistant" : msg.role,
      message: msg.message,
    }));

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: userMessage,
          context: context,
          type: "explanation_chat",
          conversationHistory: apiConversationHistory,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error);
      }

      return data.content;
    } catch (error) {
      console.error("Error getting chat response:", error);
      return `Sorry, I encountered an error: ${error.message}. Please try asking your question again.`;
    }
  };

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
      console.log(
        "New position after blank: ",
        currentPosition + blankMatch[0].length
      );

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

  function useAnimatedTextDisplay(
    fullTextToDisplay: string,
    onAnimationComplete?: () => void
  ) {
    const animationProgress = useMotionValue(0);
    const [visibleCharCount, setVisibleCharCount] = useState(0);
    const prevTextRef = useRef(fullTextToDisplay);

    useEffect(() => {
      const newText = fullTextToDisplay;
      const oldText = prevTextRef.current;
      let charsToAnimateThisTime: number;

      if (newText.startsWith(oldText)) {
        charsToAnimateThisTime = newText.length - oldText.length;
      } else {
        animationProgress.jump(0);
        setVisibleCharCount(0);
        charsToAnimateThisTime = newText.length;
      }

      if (charsToAnimateThisTime <= 0 && newText.startsWith(oldText)) {
        if (animationProgress.get() !== newText.length) {
          setVisibleCharCount(newText.length);
          animationProgress.jump(newText.length);
        }
        onAnimationComplete?.();
        prevTextRef.current = newText;
        return;
      }

      const duration = Math.max(
        0.05,
        charsToAnimateThisTime / ANIMATION_CHARS_PER_SECOND
      );

      const animationControls = animate(animationProgress, newText.length, {
        duration,
        ease: "linear",
        onUpdate: (latest) => setVisibleCharCount(Math.floor(latest)),
        onComplete: () => {
          setVisibleCharCount(newText.length);
          animationProgress.jump(newText.length);
          onAnimationComplete?.();
        },
      });

      prevTextRef.current = newText;
      return () => animationControls.stop();
    }, [fullTextToDisplay, animationProgress, onAnimationComplete]);

    return fullTextToDisplay.slice(0, visibleCharCount);
  }

  // Event handlers
  const handleReset = () => {
    setIsTyping(false);
    setRevealedText("");
    setCurrentPosition(0);
    setIsWaitingForBlankFill(false);
    setUserInput("");
    setCurrentBlankAnswer(null);
    setFeedbackMessage("");
    setIsPreparingForBlank(false);
    setIsWaitingForParagraphFeedback(false);
    setParagraphFeedbackMessage("");
    setParagraphAccordions([]);
    setCurrentAccordionId(null);
    setCurrentChatInput("");
    setIsLoadingResponse(false);
    setBlankResponses([]);
    setIsContentComplete(false);
  };

  const handleNextQuestion = () => {
    // Only allow if current question is complete
    if (isContentComplete && currentQuestionIndex < allQuestions.length - 1) {
      const nextIndex = currentQuestionIndex + 1;

      // Log navigation
      logUserAction("question_navigation", {
        from: currentQuestionIndex,
        to: nextIndex,
        direction: "next",
      });

      setCurrentQuestionIndex(nextIndex);
      setCurrentQuestion(allQuestions[nextIndex]);
      handleReset(); // Reset all states for new question
    }
  };

  const handlePreviousQuestion = () => {
    if (currentQuestionIndex > 0) {
      const prevIndex = currentQuestionIndex - 1;
      setCurrentQuestionIndex(prevIndex);
      setCurrentQuestion(allQuestions[prevIndex]);
      handleReset(); // Reset all states for new question
    }
  };

  const handlePlayPause = () => {
    if (!currentQuestion) return;

    if (
      !isTyping &&
      currentPosition >= aiText.length &&
      !getNextSegment(1).isBlank
    ) {
      return;
    }

    const newTypingState = !isTyping;
    setIsTyping(newTypingState);

    // Log the action
    logUserAction(newTypingState ? "streaming_started" : "streaming_paused", {
      questionId: currentQuestion.id,
      position: currentPosition,
    });
  };

  const handleParagraphFeedback = (understood: boolean) => {
    // Log feedback
    logUserAction("paragraph_feedback", {
      questionId: currentQuestion?.id,
      understood,
      position: currentPosition,
    });

    const accordionId = `${currentPosition}`;
    const fullContextUpToNow = aiText.slice(0, currentPosition).trim();

    if (understood) {
      // Store the feedback immediately for "understood" responses
      const newAccordion: ParagraphAccordion = {
        id: accordionId,
        position: currentPosition,
        chatMessages: [],
        paragraphContext: fullContextUpToNow || "No previous content available",
        userFeedback: "understood",
      };
      setParagraphAccordions((prev) => [...prev, newAccordion]);

      setParagraphFeedbackMessage("Great! Continuing...");
      setTimeout(() => {
        setParagraphFeedbackMessage("");
        setIsWaitingForParagraphFeedback(false);
        setCurrentAccordionId(null);
        setIsTyping(true);
      }, 300);
    } else {
      // For "did not understand", create accordion for interaction
      console.log("Storing full context:", fullContextUpToNow);

      const newAccordion: ParagraphAccordion = {
        id: accordionId,
        position: currentPosition,
        chatMessages: [],
        paragraphContext: fullContextUpToNow || "No previous content available",
        userFeedback: "did_not_understand",
      };
      setParagraphAccordions((prev) => [...prev, newAccordion]);
      setCurrentAccordionId(accordionId);
    }
  };

  const handleChatSubmit = async (accordionId: string) => {
    if (!currentChatInput.trim() || isLoadingResponse) return;

    const userMessage = currentChatInput;
    setCurrentChatInput("");
    setIsLoadingResponse(true);

    const accordion = paragraphAccordions.find((acc) => acc.id === accordionId);
    let context = accordion?.paragraphContext;

    if (
      !context ||
      context.trim() === "" ||
      context === "Previous explanation content"
    ) {
      context = getCurrentParagraphContext();
    }

    console.log("Using context for chat:", context.slice(0, 200) + "...");

    // Get conversation history for this accordion
    const conversationHistory = accordion?.chatMessages || [];

    // Add user message immediately
    setParagraphAccordions((prev) =>
      prev.map((accordion) =>
        accordion.id === accordionId
          ? {
              ...accordion,
              chatMessages: [
                ...accordion.chatMessages,
                { role: "user", message: userMessage },
              ],
            }
          : accordion
      )
    );

    try {
      // Pass conversation history to the AI
      const aiResponse = await getChatResponse(
        userMessage,
        context,
        conversationHistory
      );

      setParagraphAccordions((prev) =>
        prev.map((accordion) =>
          accordion.id === accordionId
            ? {
                ...accordion,
                chatMessages: [
                  ...accordion.chatMessages,
                  { role: "ai", message: aiResponse },
                ],
              }
            : accordion
        )
      );
    } catch (error) {
      setParagraphAccordions((prev) =>
        prev.map((accordion) =>
          accordion.id === accordionId
            ? {
                ...accordion,
                chatMessages: [
                  ...accordion.chatMessages,
                  {
                    role: "ai",
                    message:
                      "Sorry, I couldn't process your question right now. Please try again.",
                  },
                ],
              }
            : accordion
        )
      );
    } finally {
      setIsLoadingResponse(false);
    }
  };

  const handleContinueAfterChat = () => {
    // The accordion already has the feedback stored, just continue
    setParagraphFeedbackMessage("Thanks for the questions! Continuing...");
    setTimeout(() => {
      setParagraphFeedbackMessage("");
      setIsWaitingForParagraphFeedback(false);
      setCurrentAccordionId(null);
      setIsTyping(true);
    }, 1000);
  };

  const handleUserInputSubmit = () => {
    if (!userInput.trim() || !currentBlankAnswer) return;

    const isCorrect =
      userInput.trim().toLowerCase() === currentBlankAnswer.toLowerCase();

    // Log blank response
    logUserAction("blank_response", {
      questionId: currentQuestion?.id,
      userAnswer: userInput.trim(),
      correctAnswer: currentBlankAnswer,
      isCorrect,
      position: currentPosition,
    });

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
          const afterBlank = prev.slice(
            lastBlankIndex + blankPlaceholder.length
          );

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
      setIsPreparingForBlank(false);

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

  const handleAnimationComplete = () => {
    if (isPreparingForBlank) {
      setIsWaitingForBlankFill(true);
      setIsPreparingForBlank(false);
    }
  };

  // Main typing effect
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
          const textUpToParagraph = segment.text.slice(
            0,
            paragraphBreakIndex + 2
          );
          setRevealedText((prev) => prev + textUpToParagraph);
          setCurrentPosition(currentPosition + textUpToParagraph.length);
          setIsTyping(false);
          setIsWaitingForParagraphFeedback(true);
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
        setIsPreparingForBlank(true);
      } else {
        setIsTyping(false);
        setIsContentComplete(true);
      }
    }, TYPING_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [isTyping, currentPosition, currentQuestion]);

  const animatedRevealedText = useAnimatedTextDisplay(
    revealedText,
    handleAnimationComplete
  );

  // Get current chat messages for the active accordion
  const currentChatMessages = currentAccordionId
    ? paragraphAccordions.find((acc) => acc.id === currentAccordionId)
        ?.chatMessages || []
    : [];

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.href = "/auth/login";
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  // Add this function near the top of your component
  const logUserAction = async (action: string, details: any = {}) => {
    try {
      await fetch("/api/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, details }),
      });
    } catch (error) {
      console.error("Failed to log action:", error);
    }
  };

  if (isLoadingQuestions) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div>Loading...</div>
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
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">AI Thinking</h1>
        <button
          onClick={handleLogout}
          className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded"
        >
          Logout
        </button>
      </div>

      {/* Question Navigation */}
      <div className="mb-6 flex items-center justify-between bg-gray-800 rounded-lg p-4">
        <div>
          <h2 className="text-xl font-semibold">{currentQuestion.question}</h2>
          <p className="text-sm text-gray-400 mt-1">
            Question {currentQuestionIndex + 1} of {allQuestions.length}
          </p>
        </div>
        <div className="flex gap-2">
          {currentQuestionIndex > 0 && (
            <button
              onClick={handlePreviousQuestion}
              className="bg-blue-500 hover:bg-blue-700 text-white px-4 py-2 rounded font-medium"
            >
              Previous
            </button>
          )}
          {currentQuestionIndex < allQuestions.length - 1 && (
            <button
              onClick={handleNextQuestion}
              disabled={!isContentComplete}
              className={`px-4 py-2 rounded font-medium ${
                !isContentComplete
                  ? "bg-gray-600 text-gray-400 cursor-not-allowed"
                  : "bg-blue-500 hover:bg-blue-700 text-white"
              }`}
              title={
                !isContentComplete ? "Complete the current question first" : ""
              }
            >
              Next
            </button>
          )}
        </div>
      </div>

      {/* Show "Next Question" button when current question is completed */}
      {isContentComplete && currentQuestionIndex < allQuestions.length - 1 && (
        <div className="mb-6 p-4 bg-green-800 rounded-lg flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-green-200">
              Question Complete!
            </h3>
            <p className="text-green-300">
              Ready to move to the next question?
            </p>
          </div>
          <button
            onClick={handleNextQuestion}
            className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-6 rounded"
          >
            Next Question →
          </button>
        </div>
      )}

      {/* Show completion message when all questions are done */}
      {isContentComplete && currentQuestionIndex >= allQuestions.length - 1 && (
        <div className="mb-6 p-4 bg-purple-800 rounded-lg text-center">
          <h3 className="text-lg font-semibold text-purple-200">
            🎉 All Questions Complete!
          </h3>
          <p className="text-purple-300">
            You've finished all available questions. Great job!
          </p>
        </div>
      )}

      <div className="mt-6">
        <button
          onClick={handlePlayPause}
          className={`${
            isTyping
              ? "bg-red-500 hover:bg-red-700"
              : "bg-blue-500 hover:bg-blue-700"
          } text-white font-bold py-2 px-4 rounded mr-2`}
        >
          {isTyping ? "Pause" : "Start"}
        </button>
        <button
          onClick={handleReset}
          className="bg-gray-500 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded"
        >
          Reset
        </button>
      </div>

      <div className="font-sans text-lg mt-6">
        <div>
          <TextRenderer
            text={animatedRevealedText}
            paragraphAccordions={paragraphAccordions}
            currentAccordionId={currentAccordionId}
            // Pass the readonly feedback component as a prop
            renderReadonlyFeedback={(accordion: ParagraphAccordion) => (
              <div className="mb-4 p-3 bg-gray-800 rounded-lg border-l-4 border-blue-500">
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className={`w-3 h-3 rounded-full ${
                      accordion.userFeedback === "understood"
                        ? "bg-green-500"
                        : "bg-yellow-500"
                    }`}
                  ></div>
                  <span className="text-sm font-medium text-gray-300">
                    Your Response:
                    <span
                      className={`ml-2 ${
                        accordion.userFeedback === "understood"
                          ? "text-green-400"
                          : "text-yellow-400"
                      }`}
                    >
                      {accordion.userFeedback === "understood"
                        ? "✓ I understand"
                        : "❓ I did not understand"}
                    </span>
                  </span>
                </div>

                {/* Show chat history if they asked questions */}
                {accordion.chatMessages.length > 0 && (
                  <div className="mt-3 pl-4 border-l-2 border-gray-600">
                    <div className="text-xs text-gray-500 mb-2">
                      Chat History:
                    </div>
                    {accordion.chatMessages.map((msg, index) => (
                      <div
                        key={index}
                        className={`mb-2 text-sm ${
                          msg.role === "user"
                            ? "text-blue-300"
                            : "text-gray-300"
                        }`}
                      >
                        <strong>{msg.role === "user" ? "You" : "AI"}:</strong>{" "}
                        {msg.message}
                      </div>
                    ))}

                    {/* Indicate AI memory of previous messages */}
                    {accordion.chatMessages.length > 1 && (
                      <div className="text-xs text-gray-500 mb-2 italic">
                        💭 AI remembers our previous{" "}
                        {Math.floor(accordion.chatMessages.length / 2)}{" "}
                        exchanges
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          />

          {/* Paragraph feedback */}
          {isWaitingForParagraphFeedback && (
            <ParagraphFeedback
              currentAccordionId={currentAccordionId}
              onFeedback={handleParagraphFeedback}
              feedbackMessage={paragraphFeedbackMessage}
              onChatSubmit={handleChatSubmit}
              currentChatInput={currentChatInput}
              setCurrentChatInput={setCurrentChatInput}
              isLoadingResponse={isLoadingResponse}
              onContinueAfterChat={handleContinueAfterChat}
              chatMessages={currentChatMessages}
            />
          )}

          {/* Blank input */}
          {isWaitingForBlankFill && currentBlankAnswer && (
            <BlankInput
              userInput={userInput}
              setUserInput={setUserInput}
              onSubmit={handleUserInputSubmit}
              currentBlankAnswer={currentBlankAnswer}
              feedbackMessage={feedbackMessage}
            />
          )}
        </div>

        {/* Performance summary */}
        <PerformanceSummary
          blankResponses={blankResponses}
          isContentComplete={isContentComplete}
        />
      </div>
    </div>
  );
}

export default StreamingPage;
