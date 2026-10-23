// scripts/reset-db.js
const { drizzle } = require("drizzle-orm/postgres-js");
const postgres = require("postgres");

// Load environment variables
require("dotenv").config({ path: [".env.local", ".env"] });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("❌ DATABASE_URL not found in environment variables");
  process.exit(1);
}

const client = postgres(connectionString, { prepare: false });
const db = drizzle(client);

async function resetDatabase() {
  try {
    console.log("🔄 Resetting database...");

    // Drop all tables
    console.log("🗑️  Dropping existing tables...");
    await client`DROP TABLE IF EXISTS logs CASCADE`;
    await client`DROP TABLE IF EXISTS questions CASCADE`;
    await client`DROP TABLE IF EXISTS users CASCADE`;

    // Create tables
    console.log("🏗️  Creating tables...");

    // Users table
    await client`
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT now()
      )
    `;

    // Questions table
    await client`
      CREATE TABLE questions (
        id SERIAL PRIMARY KEY,
        question TEXT NOT NULL,
        content TEXT NOT NULL,
        answer TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT now()
      )
    `;

    // Seed data for questions table
    const questions = [
      {
        question: `Differentiate between max and minimum keys in dictionary\n\nWrite a function named identical that accepts a dictionary P and an integer val as arguments. Both the keys and values of P are integers. The function should return -1 if val is not a value corresponding to any key in the dictionary. If val is one of the values, then the function should return the difference between the maximum and minimum keys that have a value of val.\n\nFor example: identical({1: 3, 4: 2, 5: 3, 7: 3}, 3) should return 6. Of the keys which have a value 3 — 1, 5 and 7 — the difference between the maximum and minimum is 7−1=6.\n\nYou do not have to accept input from the user or print the output to the console. You just have to write the function definition.`,
        content: `Okay, I need to write a Python function called identical that takes two arguments: a dictionary P and an integer val. Both keys and values are integers, so that's good.\n\nThe function should return -1 if val is not found in P. If it is found, then we need to find all the keys with value equal to val, determine the maximum and minimum of those keys, subtract them, and return that difference. Otherwise, return -1 as per the instructions.\n\nFirst, check if val exists in P. If not, return -1 immediately.\n\nIf it does exist, extract all the key-value pairs where value is equal to val. Then find the max and min of those keys.\n\nYou can iterate through each item in P.items(), check if the value equals val, and collect the keys into a list.\n\nOnce you have that list, compute max_key = max(keys) and min_key = min(keys). Then return max_key - min_key.\n\nIf there are multiple keys with the same value, all of them will be included in the list, so both max and min would correctly find the correct values.\n\nTesting example: identical({1:3,4:2,5:3,7:3}, 3) should return 6. Keys with value 3 are 1,5,7. Max is 7, min is 1, so the difference is 6.\n\nAnother test case: identical({2:4}, 3) should return -1.\n\nIf P is empty, return -1.\n\nFunction outline:\n\ndef identical(P, val):\n    if val not in P:\n        return -1\n    keys = [k for k, v in P.items() if v == val]\n    max_k = max(keys)\n    min_k = min(keys)\n    return max_k - min_k\n`,
        answer: "\n### Explanation\n- **Check for Presence**: The function first checks if the value val is present in the dictionary using if val not in P.\n- **Extract Keys**: If the value is found, it extracts all keys that have this value into a list.\n- **Compute Difference**: Using Python's built-in max() and min() functions, the function computes the maximum key and the minimum key from the extracted list. The difference between these two values is returned.\n\nThis solution efficiently handles both the presence check and the computation of the key range difference in linear time relative to the number of keys with the target value, making it optimal for this problem."
      },
      {
        question: `If 𝐴 and 𝐵 are two matrices of the same dimensions, then the element-wise maximum of the two matrices is another matrix 𝐶 of the same dimensions and is defined as follows:\n\n𝐶𝑖𝑗=max(𝐴𝑖𝑗,𝐵𝑖𝑗)\nThat is, each element of 𝐶 is the maximum of the corresponding elements in 𝐴 and 𝐵. Note that 𝐴 and 𝐵 can be rectangular matrices.\n\nWrite a function named matrix_max that accepts two matrices A and B as arguments. It should return the element-wise maximum matrix.\n\n(1) You can assume that A and B will have the same dimensions.\n\n(2) You do not have to accept input from the user or print output to the console. Just write the function definition.`,
        content: `Okay, so I need to write a Python function called matrix_max that takes two matrices A and B as arguments and returns their element-wise maximum. Hmm, let me think about how to approach this.\n\nFirst, what's an element-wise max? Oh right, for each corresponding element in A and B, we take the larger one. So if A is 3x2 and B is also 3x2, after processing, C should be 3x2 as well.\n\nWait, I remember that Python has a lot of matrix operations already built-in. Like NumPy. Oh right, because using NumPy can simplify this process. Because without it, handling element-wise max manually could get messy.\n\nSo the plan is: use NumPy's maximum function to compute C. How does that work? Well, if I stack A and B as arrays and take their maximum, that should do it.\n\nBut wait, how about if someone passes lists instead of NumPy arrays? Then converting them with np.array would create an array. So perhaps it's better to do something like:\n\nimport numpy as np\n\ndef matrix_max(A, B):\n\treturn np.maximum(A, B)\n\nBut wait, the problem says that A and B are two matrices, so if they're passed in as lists or whatever, then this should work.\n\nWait no, but let me think. If the user passes a list instead of an array, like [[1,2], [3,4]], converting it to np.array would make sense because then we can apply the maximum function.\n\nSo yes, perhaps that's the way to go.\n\nLet me also consider edge cases: what if one of them is empty? But since the problem says they have the same dimensions, I don't need to handle that. Also, for non-integer types, like strings or other objects—probably not an issue as long as all elements are comparable with max.\n\nWait another thing: in Python, when you take np.maximum(A, B), if A and B are of different shapes but the same size? Wait no, because it's said that they have the same dimensions. So the function can assume that len(A) equals len(B), etc.\n\nSo putting it all together, the code would be:\n\nimport numpy as np\n\ndef matrix_max(A, B):\n\ta = np.array(A)\n\tb = np.array(B)\n\treturn np.maximum(a, b)\n\nWait but wait: if A and B are lists of numbers, not numpy arrays, then we can convert them with np.array. So perhaps more generally:\n\ndef matrix_max(A, B):\n\t# Convert the inputs to NumPy arrays\n\ta = np.array(A)\n\tb = np.array(B)\n\t# Compute element-wise max\n\tc = np.maximum(a, b)\n\treturn c\n\nBut wait, this works whether A and B are lists or numpy arrays. So perhaps that's better.\n\nLet me test with an example: suppose A is [[1,2], [3,4]] and B is [[5,6], [7,8]]. Then np.maximum(A, B) should return [[5,6],[7,8]], which is correct.\n\nAnother example: if A = [1, 2, 3] and B = [4,5,6], then the result would be [4,5,6].\n\nBut wait, what about if A and B are of different dimensions? But according to problem statement, they have same dimensions. So that's okay.\n\nSo this function should work as intended.\n`,
        answer: "To solve this problem, we need to write a function named matrix_max that takes two matrices of the same dimensions and returns another matrix where each element is the maximum value from the corresponding elements in the input matrices.\n\n### Approach\nThe approach to solve this problem involves using NumPy's built-in functions to handle the matrix operations efficiently. Here's a step-by-step breakdown of the approach:\n\n1. **Convert Input Matrices**: Convert the input lists into NumPy arrays, as NumPy provides efficient and optimized functions for matrix operations.\n2. **Element-wise Maximum Calculation**: Use NumPy's np.maximum function to compute the element-wise maximum values between the two matrices.\n3. **Return Result**: Return the resulting matrix from the calculation.\n\nThis approach leverages the power of NumPy, which simplifies matrix operations and ensures efficient performance even for larger matrices.\n\n### Solution Code\nimport numpy as np\n\ndef matrix_max(A, B):\n\ta = np.array(A)\n\tb = np.array(B)\n\treturn np.maximum(a, b)\n\n### Explanation\n1. **Conversion to NumPy Arrays**: The function starts by converting the input lists A and B into NumPy arrays using np.array(). This allows us to use efficient matrix operations provided by NumPy.\n2. **Element-wise Maximum Calculation**: Using np.maximum(a, b), we compute a new array where each element is the maximum value from the corresponding elements in a (converted from A) and b (converted from B). This function efficiently handles matrices of any size as long as they have the same dimensions.\n3. **Efficiency and Clarity**: By using NumPy, we avoid the overhead of Python's general list operations, making the code more efficient and readable.\n\nThis solution is both concise and efficient, handling the element-wise maximum operation in a straightforward manner that leverages the power of NumPy for matrix operations."
      }
    ];
    for (const q of questions) {
      await client`INSERT INTO questions (question, content, answer) VALUES (${q.question}, ${q.content}, ${q.answer})`;
    }
    // Log the added questions to the terminal
    console.log('\nQuestions added to the database:');
    questions.forEach((q, idx) => {
      console.log(`${idx + 1}. ${q.question.split('\n')[0]}`);
    });

    // Logs table
    await client`
      CREATE TABLE logs (
        id SERIAL PRIMARY KEY,
        user_id TEXT,
        action TEXT NOT NULL,
        details JSONB DEFAULT '{}'::jsonb,
        level TEXT NOT NULL,
        timestamp TIMESTAMP WITH TIME ZONE DEFAULT now()
      )
    `;

    // Create indexes for logs table
    await client`CREATE INDEX IF NOT EXISTS idx_logs_user_id ON logs(user_id)`;
    await client`CREATE INDEX IF NOT EXISTS idx_logs_action ON logs(action)`;
    await client`CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp)`;
    await client`CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level)`;

    console.log("✅ Tables created successfully");
    console.log("");
    console.log("🎉 Database reset complete!");
    console.log("");
    // questions added with emoji
    console.log("📝 Questions added to the database:");
    console.log("")
    console.log("📋 Empty tables created:");
    console.log("   - users (0 records)");
    console.log("   - questions (2 records)");
    console.log("   - logs (0 records)");
    console.log("");
    console.log("🚀 You can now start your application with: pnpm dev");
  } catch (error) {
    console.error("❌ Error resetting database:", error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

resetDatabase();
