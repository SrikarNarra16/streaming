"use client";

// ---------------------------------------------------------------------------

// TODO: Logging, Login, and DB
// Add question on the top and to the chat
// Add conversation history to the chat
// After each paragraph answer of the user to the feedback readonly
// Make more prominent: 3 ✗ (Correct Answer: 6)
// After thinking show the actual AI response
// Performace: Add how many times they said I did not understand
// Readme add paragraphs details and code formatting

// ---------------------------------------------------------------------------
import React, { useEffect, useRef, useState } from "react";
import { animate, useMotionValue } from "framer-motion";

import { BlankInput } from "@/components/streaming/BlankInput";
import { ParagraphFeedback } from "@/components/streaming/ParagraphFeedback";
import { PerformanceSummary } from "@/components/streaming/PerformanceSummary";
import { TextRenderer } from "@/components/streaming/TextRenderer";

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
  const aiText = `Okay, I need to write a Python function called identical that takes two arguments: a dictionary P and an integer val. Both keys and values are integers, so that's good. The function should return -1 if val is not found in P. If it is found, then we need to find all the keys with value equal to val, determine the maximum and minimum of those keys, subtract them, and return that difference. Otherwise, return -1 as per the instructions.

Let me think about the steps I need to take. First, check if val exists in P. If not, return -1 immediately. If it does exist, extract all the key-value pairs where value is equal to val. Then find the max and min of those keys. How do I get all such keys? Well, I can iterate through each item in P.items(), check if the value equals val, collect them into a list. Alternatively, maybe using a dictionary comprehension would be efficient.

Once I have that list, I can compute max_key = max(keys) and min_key = min(keys). Then return (max_key - min_k). Wait, but what if there are multiple keys with the same value? That's fine because all of them will be included in the list, so both max and min would correctly find the correct values.

Testing example: \`identical({1:3,4:2,5:3,7:3}, 3)\` should return 6. Let me see—keys with value 3 are 1,5,7. Max is 7, min is 1, so the difference is 6. That's correct. Another test case could be when there are no keys with val equal to any value. Like \`identical({2:4}, 3)\`—should return -1.

What about an empty dictionary? If P is empty and val is found in it (which it can't because the dictionary has no keys), but that's not possible since P would have no keys anyway, so returning -1 makes sense.

Let me outline the steps:

**Function identical(P, val):**
- Check if val is in P. How? Using 'in' keyword.
  If not present: return -1
- Else, collect all keys where value equals val.
  So, create a list of keys like \`[k for k,v in P.items() if v == val]\`
- Get max_key as the maximum of that list, min_key as the minimum.
- Return max_key - min_k.

Wait, but let me think about the sample input given. The function is called with \`{1:3,4:2,5:3,7:3}\`, and val is 3. The code would extract keys \`[1,5,7]\`, compute BLANK(6), which matches the example. So that's correct.

Another test case: \`identical({}, 0)\`. Should return -1 because val is not present. What if all keys have the same value, say \`{2:5,3:5}\`. Val is 5. The keys are \`[2,3]\`, difference is BLANK(1). Yes, that's correct. I think this should cover all cases`;

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

  // Helper functions
  const getCurrentParagraphContext = (): string => {
    const fullContext = aiText.slice(0, currentPosition).trim();
    console.log("Generated context:", fullContext);
    return fullContext || "No context available";
  };

  const getChatResponse = async (
    userMessage: string,
    context: string
  ): Promise<string> => {
    console.log("Context for chat:", context);

    if (!context || context.trim() === "") {
      console.warn("Empty context provided, using fallback");
      context = "General programming question";
    }

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: userMessage,
          context: context,
          type: "explanation_chat",
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

  const handlePlayPause = () => {
    if (
      !isTyping &&
      currentPosition >= aiText.length &&
      !getNextSegment(1).isBlank
    ) {
      return;
    }
    setIsTyping(!isTyping);
  };

  const handleParagraphFeedback = (understood: boolean) => {
    if (understood) {
      setParagraphFeedbackMessage("Great! Continuing...");
      setTimeout(() => {
        setParagraphFeedbackMessage("");
        setIsWaitingForParagraphFeedback(false);
        setCurrentAccordionId(null);
        setIsTyping(true);
      }, 300);
    } else {
      const accordionId = `${currentPosition}`;
      const fullContextUpToNow = aiText.slice(0, currentPosition).trim();

      console.log("Storing full context:", fullContextUpToNow);

      const newAccordion: ParagraphAccordion = {
        id: accordionId,
        position: currentPosition,
        chatMessages: [],
        paragraphContext: fullContextUpToNow || "No previous content available",
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
      const aiResponse = await getChatResponse(userMessage, context);

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
    if (!isTyping) return;

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
  }, [isTyping, currentPosition]);

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
