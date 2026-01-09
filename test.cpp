#include <iostream>
#include <vector>
#include <string>

using namespace std;

// Test file with common C++ errors for Tell-me extension

int main() {
    // Error 1: Undeclared variable
    cout << unknownVariable << endl;
    
    // Error 2: Missing semicolon
    int x = 10
    
    // Error 3: Type mismatch
    string text = 42;
    
    // Error 4: Undefined function
    int result = calculateSum(5, 10);
    
    // Error 5: Array index out of bounds warning
    int arr[5];
    arr[10] = 100;
    
    // Error 6: Uninitialized variable
    int uninitializedValue;
    cout << uninitializedValue << endl;
    
    // Error 7: Missing return type
    void getValue() {
        return 42;
    }
    
    // Error 8: Comparing pointer to integer
    int* ptr = nullptr;
    if (ptr == 0) {
        cout << "Null pointer" << endl;
    }
    
    // Error 9: Unused variable
    int unusedVar = 100;
    
    // Error 10: Division by zero
    int divisor = 0;
    int quotient = 100 / divisor;
    
    return 0;
}

// Error 11: Function declared but not defined
void missingFunction();
