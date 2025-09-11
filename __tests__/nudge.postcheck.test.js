const { postCheck, getFallbackMessage, detailedPostCheck, hasConcreteVerbs, FORBIDDEN } = require('../src/focus/postCheck');

describe('Nudge PostCheck System', () => {
  describe('postCheck function', () => {
    test('should pass valid nudge with correct prefix', () => {
      const output = "Your attention score is decreasing, you can try to add error handling to the login function";
      const entities = ["login", "function"];
      const confidence = "HIGH";
      
      expect(postCheck(output, entities, confidence)).toBe(true);
    });

    test('should fail without correct prefix', () => {
      const output = "You should add error handling";
      const entities = ["login"];
      const confidence = "HIGH";
      
      expect(postCheck(output, entities, confidence)).toBe(false);
    });

    test('should fail with too many words', () => {
      const output = "Your attention score is decreasing, you can try to add comprehensive error handling with detailed logging and user notifications to the main authentication login function";
      const entities = ["login"];
      const confidence = "HIGH";
      
      expect(postCheck(output, entities, confidence)).toBe(false);
    });

    test('should fail with forbidden phrases', () => {
      const output = "Your attention score is decreasing, you can try to think about the problem";
      const entities = [];
      const confidence = "LOW";
      
      expect(postCheck(output, entities, confidence)).toBe(false);
    });

    test('should pass LOW confidence without entity requirement', () => {
      const output = "Your attention score is decreasing, you can try to add comments";
      const entities = [];
      const confidence = "LOW";
      
      expect(postCheck(output, entities, confidence)).toBe(true);
    });

    test('should fail HIGH confidence without entity match', () => {
      const output = "Your attention score is decreasing, you can try to add comments";
      const entities = ["database", "authentication"];
      const confidence = "HIGH";
      
      expect(postCheck(output, entities, confidence)).toBe(false);
    });

    test('should pass HIGH confidence with entity match', () => {
      const output = "Your attention score is decreasing, you can try to refactor the authentication module";
      const entities = ["authentication", "database"];
      const confidence = "HIGH";
      
      expect(postCheck(output, entities, confidence)).toBe(true);
    });

    test('should be case insensitive for entity matching', () => {
      const output = "Your attention score is decreasing, you can try to update the UserService class";
      const entities = ["userservice", "database"];
      const confidence = "MEDIUM";
      
      expect(postCheck(output, entities, confidence)).toBe(true);
    });
  });

  describe('detailedPostCheck function', () => {
    test('should return detailed validation results', () => {
      const output = "Invalid message without prefix";
      const entities = ["test"];
      const confidence = "HIGH";
      
      const result = detailedPostCheck(output, entities, confidence);
      
      expect(result.passed).toBe(false);
      expect(result.issues).toContain('Missing required prefix');
      expect(result.issues).toContain('No entity found (confidence: HIGH)');
    });

    test('should pass with no issues', () => {
      const output = "Your attention score is decreasing, you can try to test the user authentication";
      const entities = ["authentication"];
      const confidence = "HIGH";
      
      const result = detailedPostCheck(output, entities, confidence);
      
      expect(result.passed).toBe(true);
      expect(result.issues).toHaveLength(0);
    });
  });

  describe('hasConcreteVerbs function', () => {
    test('should detect concrete action verbs', () => {
      expect(hasConcreteVerbs("add error handling")).toBe(true);
      expect(hasConcreteVerbs("refactor the code")).toBe(true);
      expect(hasConcreteVerbs("test the function")).toBe(true);
      expect(hasConcreteVerbs("think about it")).toBe(false);
      expect(hasConcreteVerbs("consider the options")).toBe(false);
    });
  });

  describe('FORBIDDEN regex', () => {
    test('should match forbidden phrases', () => {
      expect(FORBIDDEN.test("think about the problem")).toBe(true);
      expect(FORBIDDEN.test("consider this option")).toBe(true);
      expect(FORBIDDEN.test("brainstorm ideas")).toBe(true);
      expect(FORBIDDEN.test("plan your approach")).toBe(true);
      expect(FORBIDDEN.test("continue working")).toBe(true);
      expect(FORBIDDEN.test("improve the code")).toBe(true);
      expect(FORBIDDEN.test("work on the feature")).toBe(true);
      expect(FORBIDDEN.test("review the changes")).toBe(true);
      expect(FORBIDDEN.test("revisit the design")).toBe(true);
    });

    test('should not match allowed phrases', () => {
      expect(FORBIDDEN.test("add error handling")).toBe(false);
      expect(FORBIDDEN.test("refactor the function")).toBe(false);
      expect(FORBIDDEN.test("test the module")).toBe(false);
      expect(FORBIDDEN.test("write documentation")).toBe(false);
    });
  });

  describe('Edge cases', () => {
    test('should handle empty or null inputs', () => {
      expect(postCheck("", [], "LOW")).toBe(false);
      expect(postCheck(null, [], "LOW")).toBe(false);
      expect(postCheck(undefined, [], "LOW")).toBe(false);
    });

    test('should handle empty entities array', () => {
      const output = "Your attention score is decreasing, you can try to add tests";
      expect(postCheck(output, [], "LOW")).toBe(true);
      expect(postCheck(output, [], "HIGH")).toBe(true); // Should still pass if no entities available
    });

    test('should handle very short entities', () => {
      const output = "Your attention score is decreasing, you can try to add it";
      const entities = ["it", "a"]; // Too short entities
      const confidence = "HIGH";
      
      expect(postCheck(output, entities, confidence)).toBe(false);
    });

    test('should handle exact word count limit', () => {
      const output = "Your attention score is decreasing, you can try to add comprehensive error handling with detailed logging and user notifications system"; // Exactly 15 words after "try to"
      const entities = ["error"];
      const confidence = "HIGH";
      
      expect(postCheck(output, entities, confidence)).toBe(true);
    });
  });

  describe('getFallbackMessage', () => {
    test('should return valid fallback message', () => {
      const fallback = getFallbackMessage();
      expect(fallback).toBe("Your attention score is decreasing, you can try to re-read the last line and add one detail.");
      expect(postCheck(fallback, [], "LOW")).toBe(true);
    });
  });
});

describe('Integration Tests', () => {
  test('should validate messages that would pass the full system', () => {
    const testCases = [
      {
        output: "Your attention score is decreasing, you can try to add unit tests for UserService",
        entities: ["UserService", "authentication"],
        confidence: "HIGH",
        expected: true
      },
      {
        output: "Your attention score is decreasing, you can try to refactor the database connection",
        entities: ["database", "connection"],
        confidence: "MEDIUM",
        expected: true
      },
      {
        output: "Your attention score is decreasing, you can try to write documentation",
        entities: [],
        confidence: "LOW",
        expected: true
      },
      {
        output: "Your attention score is decreasing, you can try to think about the architecture",
        entities: ["architecture"],
        confidence: "HIGH",
        expected: false // Contains forbidden phrase
      },
      {
        output: "Your attention score is decreasing, you can try to add comprehensive error handling with detailed logging and user notification systems and backup procedures and additional safety measures",
        entities: ["error"],
        confidence: "HIGH",
        expected: false // Too many words (18 words > 15)
      }
    ];

    testCases.forEach(({ output, entities, confidence, expected }, index) => {
      const result = postCheck(output, entities, confidence);
      expect(result).toBe(expected, `Test case ${index + 1} failed: "${output}"`);
    });
  });
});
