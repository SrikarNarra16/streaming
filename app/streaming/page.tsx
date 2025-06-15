"use client";

// TODO: Whenever a new line ask user to continue typing
// For users answers, keep them and show to user if right or wrong
// Am I making sense? Etc after each blank, if they dont understand, they can ask questions Add an accordian for that
// Format code also to look like code, not just text
// Logging and Login

// Migrate the old project db

import React, { useEffect, useRef, useState } from "react";

import { animate, useMotionValue } from "framer-motion";

interface ThinkingSegment {
  text: string | null;
  isBlank: boolean;
  blankAnswer: string | null;
  newPosition?: number;
}

const TYPING_INTERVAL_MS = 100;
const CHARS_PER_TYPE_INTERVAL = 30;
const ANIMATION_CHARS_PER_SECOND = 30;
const FEEDBACK_DURATION_MS = 1500; //not sure

function StreamingPage() {
  const aiText = `Okay, I need to write a Python function called identical that takes two arguments: a dictionary P and an integer val. Both keys and values are integers, so that's good. The function should return -1 if val is not found in P. If it is found, then we need to find all the keys with value equal to val, determine the maximum and minimum of those keys, subtract them, and return that difference. Otherwise, return -1 as per the instructions.

Let me think about the steps I need to take. First, check if val exists in P. If not, return -1 immediately. If it does exist, extract all the key-value pairs where value is equal to val. Then find the max and min of those keys. How do I get all such keys? Well, I can iterate through each item in P.items(), check if the value equals val, collect them into a list. Alternatively, maybe using a dictionary comprehension would be efficient.

Once I have that list, I can compute max_key = max(keys) and min_key = min(keys). Then return (max_key - min_key). Wait, but what if there are multiple keys with the same value? That's fine because all of them will be included in the list, so both max and min would correctly find the correct values.

Testing example: identical({1:3,4:2,5:3,7:3}, 3) should return 6. Let me see—keys with value 3 are 1,5,7. Max is 7, min is 1, so the difference is 6. That's correct. Another test case could be when there are no keys with val equal to any value. Like identical({2:4}, 3)—should return -1.

What about an empty dictionary? If P is empty and val is found in it (which it can't because the dictionary has no keys), but that's not possible since P would have no keys anyway, so returning -1 makes sense.

Let me outline the steps:

Function identical(P, val):
- Check if val is in P. How? Using 'in' keyword.
  If not present: return -1
- Else, collect all keys where value equals val.
  So, create a list of keys like [k for k,v in P.items() if v == val]
- Get max_key as the maximum of that list, min_key as the minimum.
- Return max_key - min_key.

Wait, but what about when there are no keys with val? Well, since we already checked earlier and found val in P, that can't happen. Because if it were, then after checking, the 'else' part wouldn't be entered for that case.

So perhaps more precisely:

keys_with_val = [k for k, v in P.items() if v == val]
if not keys_with_val:
    return -1
else:
    max_k = max(keys_with_val)
    min_k = min(keys_with_val)
    return max_k - min_k
	return -1

But wait, since we already checked that 'val is in P' which means keys_with_val can't be empty. So the else part isn't needed.

	max_k = max(keys_with_val)
	min_k = min(keys_with_val)
	return max_k - min_k

def identical(P, val):
    if val not in P:
        return -1
    if val not in P:
        return -1
    keys = BLANK([k for k, v in P.items() if v == val])
	if val not in P:
    	return -1
	keys = BLANK([k for k, v in P.items() if v == val])
	max_k = max(keys)
	min_k = min(keys)
	return BLANK(max_k - min_k)

Wait, but let me think about the sample input given. The function is called with {1:3,4:2,5:3,7:3}, and val is 3. The code would extract keys [1,5,7], compute BLANK(6), which matches the example. So that's correct.

Another test case: identical({}, 0). Should return -1 because val is not present. What if all keys have the same value, say {2:5,3:5}. Val is 5. The keys are [2,3], difference is BLANK(1). Yes, that's correct. I think this should cover all cases`;

  const [currentPosition, setCurrentPosition] = useState(0);
  const [revealedText, setRevealedText] = useState("");
  const [isTyping, setIsTyping] = useState(false);

  // blanks
  const [isWaitingForBlankFill, setIsWaitingForBlankFill] = useState(false);
  const [userInput, setUserInput] = useState("");
  const [currentBlankAnswer, setCurrentBlankAnswer] = useState<string | null>(
    null
  );
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [isPreparingForBlank, setIsPreparingForBlank] = useState(false);

  //  paragraph feedback
  const [isWaitingForParagraphFeedback, setIsWaitingForParagraphFeedback] = useState(false);
  const [paragraphFeedbackMessage, setParagraphFeedbackMessage] = useState("");
  const [currentParagraphEnd, setCurrentParagraphEnd] = useState(0);

  useEffect(() => {
    if (!isTyping) {
      return; // Do nothing if not typing
    }

    // If we've reached the end of the story, stop typing
    if (currentPosition >= aiText.length && !getNextSegment(1).isBlank) {
      // check for trailing blanks
      setIsTyping(false);
      return;
    }

    const intervalId = setInterval(() => {
      const segment = getNextSegment(CHARS_PER_TYPE_INTERVAL);

      if (segment.text) {
        console.log(`Revealing text: ${segment.text}`);
        
        // Check if we've reached the end of a paragraph in this segment
        const paragraphBreakIndex = segment.text.indexOf('\n\n');
        
        if (paragraphBreakIndex !== -1) {
          // Stop at the paragraph break
          const textUpToParagraph = segment.text.slice(0, paragraphBreakIndex + 2); // +2 to include the new line characters
          setRevealedText((prev) => prev + textUpToParagraph);
          setCurrentPosition(currentPosition + textUpToParagraph.length);
          setIsTyping(false);
          setIsWaitingForParagraphFeedback(true);
        } else {
          // No paragraph break, continue normally
          setRevealedText((prev) => prev + segment.text);
          setCurrentPosition(segment.newPosition || currentPosition);
        }
      } else if (segment.isBlank) {
        setRevealedText((prev) => prev + `[${segment.blankAnswer}] `);
        setIsTyping(false);
        console.log(`Blank found: ${segment.blankAnswer}`);
        setCurrentPosition(segment.newPosition || currentPosition);
        setCurrentBlankAnswer(segment.blankAnswer); // Store the answer.
        setIsPreparingForBlank(true);
      } else {
        setIsTyping(false); // stop as we reached the end of the text
      }
    }, TYPING_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [isTyping, currentPosition]);

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
    setCurrentParagraphEnd(0);
  };

  const handleParagraphFeedback = (thumbsUp: boolean) => {
    if (thumbsUp) {
      setParagraphFeedbackMessage("Great! Continuing...");
      setTimeout(() => {
        setParagraphFeedbackMessage("");
        setIsWaitingForParagraphFeedback(false);
        setIsTyping(true); // Continue typing
      }, 1000);
    } else {
      setParagraphFeedbackMessage("Let me try to explain differently...");
      setTimeout(() => {
        setParagraphFeedbackMessage("");
        setIsWaitingForParagraphFeedback(false);
        setIsTyping(true); // Continue typing for now
      }, 2000);
    }
  };

  const handlePlayPause = () => {
    // Prevent starting if already at the end
    if (
      !isTyping &&
      currentPosition >= aiText.length &&
      !getNextSegment(1).isBlank
    ) {
      return;
    }
    setIsTyping(!isTyping);
  };

  function getNextSegment(charsToFetch: number): ThinkingSegment {
    if (currentPosition >= aiText.length) {
      return {
        text: null,
        isBlank: false,
        blankAnswer: null,
        newPosition: currentPosition,
      }; // End of story
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

  const handleUserInputSubmit = () => {
    if (!userInput.trim() || !currentBlankAnswer) return; // Don't submit empty input or if no blank is active

    const isCorrect =
      userInput.trim().toLowerCase() === currentBlankAnswer.toLowerCase();

    setFeedbackMessage(isCorrect ? "✓ Correct!" : "✗ Oops, try again!");

    setTimeout(() => {
      setUserInput("");
      setFeedbackMessage("");
      setCurrentBlankAnswer(null);
      setIsWaitingForBlankFill(false);

      // Resume typing if there's more story
      if (currentPosition < aiText.length) {
        setIsTyping(true);
      } else {
        // Check for trailing blanks
        const nextSegment = getNextSegment(1);
        setIsTyping(nextSegment.isBlank);
      }
    }, FEEDBACK_DURATION_MS);
  };

  const handleAnimationComplete = () => {
    if (isPreparingForBlank) {
      setIsWaitingForBlankFill(true); // Show the input field
      setIsPreparingForBlank(false); // We are no longer "preparing"; we ARE waiting.
    }
  };

  const animatedRevealedText = useAnimatedTextDisplay(
    revealedText,
    handleAnimationComplete // Pass our new handler
  );

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <h1 className="text-3xl font-bold mb-6">AI Thinking</h1>
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
        <p className="whitespace-pre-wrap">
          {animatedRevealedText}
          
          {/* Paragraph feedback section */}
          {isWaitingForParagraphFeedback && (
            <span className="block mt-4 p-4 bg-gray-800 rounded-lg border border-gray-600">
              <div className="text-blue-300 mb-3">Am I making sense?</div>
              <div className="flex items-center space-x-4">
                <button
                  onClick={() => handleParagraphFeedback(true)}
                  className="flex items-center px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg transition-colors"
                >
                  <span className="text-xl mr-2">👍</span>
                  <span>Yes, continue</span>
                </button>
                <button
                  onClick={() => handleParagraphFeedback(false)}
                  className="flex items-center px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
                >
                  <span className="text-xl mr-2">👎</span>
                  <span>Please clarify</span>
                </button>
              </div>
              {paragraphFeedbackMessage && (
                <div className="mt-3 text-yellow-300 font-medium">
                  {paragraphFeedbackMessage}
                </div>
              )}
            </span>
          )}

          {/* Existing blank fill section */}
          {isWaitingForBlankFill && currentBlankAnswer && (
            <span className="inline-block ml-1">
              <input
                type="text"
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && handleUserInputSubmit()}
                className="inline-block mx-1 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[80px]"
                placeholder={`[${currentBlankAnswer.length} chars]`}
                autoFocus
              />
              <button
                onClick={handleUserInputSubmit}
                className="inline-block ml-1 px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700"
              >
                Go
              </button>

              {feedbackMessage && (
                <span
                  className={`ml-2 font-medium ${
                    feedbackMessage.includes("Correct")
                      ? "text-green-400"
                      : "text-red-400"
                  }`}
                >
                  {feedbackMessage}
                </span>
              )}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

export default StreamingPage;
