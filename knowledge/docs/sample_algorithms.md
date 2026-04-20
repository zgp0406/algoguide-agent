# Dynamic Programming Notes

Dynamic programming works well when a problem has overlapping subproblems and an optimal substructure.

Typical workflow:
1. Define state.
2. Define transition.
3. Set base cases.
4. Determine iteration order.

Example: house robber
- State: dp[i] means the maximum money from the first i houses.
- Transition: dp[i] = max(dp[i - 1], dp[i - 2] + nums[i]).
- Base cases: dp[0] = 0, dp[1] = nums[0].

When explaining to a beginner, first describe the intuition, then the recurrence, then the code.

