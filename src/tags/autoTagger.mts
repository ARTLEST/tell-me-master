/**
 * Auto-tagging engine using heuristic rules and pattern matching
 * Suggests tags based on error messages and code patterns
 */
export interface TagSuggestion {
  label: string;
  confidence: number;
  description?: string;
}

/**
 * Resource for analysis (compilation output and/or source code)
 */
export interface ResourceForTagging {
  compilationOutput?: string;
  code?: string;
  language?: string;
}

/**
 * AutoTagger provides static methods for intelligent tag suggestions
 */
export class AutoTagger {
  /**
   * Suggest tags based on error keywords and code patterns
   */
  static suggestTags(resource: ResourceForTagging): TagSuggestion[] {
    const suggestions: TagSuggestion[] = [];
    const seenLabels = new Set<string>();

    // Parse compilation output for error patterns
    if (resource.compilationOutput) {
      const errorSuggestions = this.analyzeCompilationErrors(resource.compilationOutput);
      for (const suggestion of errorSuggestions) {
        if (!seenLabels.has(suggestion.label)) {
          suggestions.push(suggestion);
          seenLabels.add(suggestion.label);
        }
      }
    }

    // Analyze source code patterns
    if (resource.code) {
      const codePatternSuggestions = this.analyzeCodePatterns(
        resource.code,
        resource.language || 'c'
      );
      for (const suggestion of codePatternSuggestions) {
        if (!seenLabels.has(suggestion.label) && suggestions.length < 3) {
          suggestions.push(suggestion);
          seenLabels.add(suggestion.label);
        }
      }
    }

    // Sort by confidence and return top 3
    return suggestions
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3);
  }

  /**
   * Analyze compilation errors for error patterns
   */
  private static analyzeCompilationErrors(output: string): TagSuggestion[] {
    const suggestions: TagSuggestion[] = [];
    const lowerOutput = output.toLowerCase();

    // Undefined reference errors
    if (lowerOutput.includes('undefined reference')) {
      suggestions.push({
        label: 'undefined-reference',
        confidence: 0.95,
        description: 'Function or variable not defined or linked',
      });
    }

    // Segmentation fault
    if (
      lowerOutput.includes('segmentation fault') ||
      lowerOutput.includes('segfault') ||
      lowerOutput.includes('sigsegv')
    ) {
      suggestions.push({
        label: 'memory-access-violation',
        confidence: 0.98,
        description: 'Segmentation fault - invalid memory access',
      });
    }

    // Null pointer dereference
    if (
      lowerOutput.includes('null pointer') ||
      lowerOutput.includes('nullptr') ||
      lowerOutput.includes('0x0')
    ) {
      suggestions.push({
        label: 'null-pointer',
        confidence: 0.92,
        description: 'Attempted dereference of null pointer',
      });
    }

    // Memory allocation errors
    if (
      lowerOutput.includes('malloc') ||
      lowerOutput.includes('allocation failure') ||
      lowerOutput.includes('out of memory')
    ) {
      suggestions.push({
        label: 'memory-allocation',
        confidence: 0.88,
        description: 'Dynamic memory allocation issue',
      });
    }

    // Buffer overflow
    if (
      lowerOutput.includes('buffer overflow') ||
      lowerOutput.includes('stack-buffer-overflow')
    ) {
      suggestions.push({
        label: 'buffer-overflow',
        confidence: 0.96,
        description: 'Buffer overflow detected',
      });
    }

    // Type mismatch
    if (
      lowerOutput.includes('incompatible pointer') ||
      lowerOutput.includes('conversion')
    ) {
      suggestions.push({
        label: 'type-error',
        confidence: 0.85,
        description: 'Type mismatch or invalid conversion',
      });
    }

    // Syntax errors
    if (
      lowerOutput.includes('syntax error') ||
      lowerOutput.includes('expected')
    ) {
      suggestions.push({
        label: 'syntax-error',
        confidence: 0.98,
        description: 'Code syntax error',
      });
    }

    // Unused variables
    if (lowerOutput.includes('unused variable')) {
      suggestions.push({
        label: 'unused-variable',
        confidence: 0.90,
        description: 'Declared but unused variable',
      });
    }

    return suggestions;
  }

  /**
   * Analyze source code for common patterns
   */
  private static analyzeCodePatterns(
    code: string,
    language: string
  ): TagSuggestion[] {
    const suggestions: TagSuggestion[] = [];

    if (language !== 'c' && language !== 'cpp') {
      return suggestions;
    }

    // Dynamic memory management pattern
    if (
      (code.includes('malloc') || code.includes('calloc') || code.includes('new')) &&
      !code.includes('valgrind')
    ) {
      suggestions.push({
        label: 'manual-memory-management',
        confidence: 0.82,
        description: 'Manual memory allocation detected',
      });
    }

    // Free/delete pattern
    if (code.includes('free(') || code.includes('delete')) {
      suggestions.push({
        label: 'memory-deallocation',
        confidence: 0.80,
        description: 'Manual memory deallocation',
      });
    }

    // Pointer arithmetic
    if (code.includes('*') && code.includes('++')) {
      suggestions.push({
        label: 'pointer-manipulation',
        confidence: 0.75,
        description: 'Pointer arithmetic operations',
      });
    }

    // Recursion pattern
    if (this.hasRecursion(code)) {
      suggestions.push({
        label: 'recursion',
        confidence: 0.88,
        description: 'Recursive function calls detected',
      });
    }

    // File I/O
    if (
      code.includes('fopen') ||
      code.includes('fread') ||
      code.includes('fwrite') ||
      code.includes('ifstream') ||
      code.includes('ofstream')
    ) {
      suggestions.push({
        label: 'file-io',
        confidence: 0.85,
        description: 'File input/output operations',
      });
    }

    // String manipulation
    if (
      code.includes('strcpy') ||
      code.includes('strcat') ||
      code.includes('sprintf')
    ) {
      suggestions.push({
        label: 'string-unsafe-functions',
        confidence: 0.92,
        description: 'Use of unsafe string functions',
      });
    }

    // Loop patterns
    if (code.includes('for') || code.includes('while')) {
      suggestions.push({
        label: 'iteration',
        confidence: 0.70,
        description: 'Loop structures detected',
      });
    }

    // Printf/cout debugging
    if (code.includes('printf') || code.includes('cout')) {
      suggestions.push({
        label: 'debug-output',
        confidence: 0.75,
        description: 'Debug print statements detected',
      });
    }

    return suggestions;
  }

  /**
   * Simple recursion detection
   */
  private static hasRecursion(code: string): boolean {
    // Match function definitions
    const functionNameMatch = code.match(/\b(?:int|void|char|double|float|bool|auto)\s+(\w+)\s*\(/);
    if (!functionNameMatch) {
      return false;
    }

    const functionName = functionNameMatch[1];
    // Check if function calls itself
    const callPattern = new RegExp(`${functionName}\\s*\\(`);
    return callPattern.test(code);
  }
}
