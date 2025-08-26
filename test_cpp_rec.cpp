#include <bits/stdc++.h>
using namespace std;
long long C(long long n)
{
    if (n <= 1)
        return 1;
    long long s = 0;
    for (long long i = 0; i < n; i++)
        s += C(i) * C(n - 1 - i);
    return s;
}
int main()
{
    long long n;
    if (!(cin >> n))
        return 0;
    cout << C(n) << "\n";
}
