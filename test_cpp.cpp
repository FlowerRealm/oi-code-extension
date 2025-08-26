#include <bits/stdc++.h>
using namespace std;
long long C[40];
int main()
{
    long long n;
    if (!(cin >> n))
        return 0;
    C[0] = 1;
    C[1] = 1;
    for (int i = 2; i <= n; i++) {
        C[i] = 0;
        for (int j = 0; j < i; j++)
            C[i] += C[j] * C[i - 1 - j];
    }
    cout << C[n] << "\n";
}
