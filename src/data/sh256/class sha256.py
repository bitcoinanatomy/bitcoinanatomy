# Based on
# https://stackoverflow.com/questions/7321694/sha-256-implementation-in-python#answer-67535007
# Arty user:941531

class Sha256:
    ks = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
        0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
        0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
        0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
        0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
        0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
        0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
        0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ]

    hs = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]

    M32 = 0xFFFFFFFF

    def __init__(self, m = None):
        self.mlen = 0
        self.buf = b''
        self.k = self.ks[:]
        self.h = self.hs[:]
        self.fin = False
        if m is not None:
            self.update(m)

    @staticmethod
    def pad(mlen):
        mdi = mlen & 0x3F
        length = (mlen << 3).to_bytes(8, 'big')
        padlen = 55 - mdi if mdi < 56 else 119 - mdi
        return b'\x80' + b'\x00' * padlen + length

    @staticmethod
    def ror(x, y):
        return ((x >> y) | (x << (32 - y))) & Sha256.M32

    @staticmethod
    def maj(x, y, z):
        return (x & y) ^ (x & z) ^ (y & z)

    @staticmethod
    def ch(x, y, z):
        return (x & y) ^ ((~x) & z)

    def compress(self, c):
        w = [0] * 64
        w[0 : 16] = [int.from_bytes(c[i : i + 4], 'big') for i in range(0, len(c), 4)]

        for i in range(16, 64):
            s0 = self.ror(w[i - 15],  7) ^ self.ror(w[i - 15], 18) ^ (w[i - 15] >>  3)
            s1 = self.ror(w[i -  2], 17) ^ self.ror(w[i -  2], 19) ^ (w[i -  2] >> 10)
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) & self.M32

        a, b, c, d, e, f, g, h = self.h

        for i in range(64):
            s0 = self.ror(a, 2) ^ self.ror(a, 13) ^ self.ror(a, 22)
            t2 = s0 + self.maj(a, b, c)
            s1 = self.ror(e, 6) ^ self.ror(e, 11) ^ self.ror(e, 25)
            t1 = h + s1 + self.ch(e, f, g) + self.k[i] + w[i]

            h = g
            g = f
            f = e
            e = (d + t1) & self.M32
            d = c
            c = b
            b = a
            a = (t1 + t2) & self.M32

        for i, (x, y) in enumerate(zip(self.h, [a, b, c, d, e, f, g, h])):
            self.h[i] = (x + y) & self.M32

    def update(self, m):
        if m is None or len(m) == 0:
            return

        assert not self.fin, 'Hash already finalized and can not be updated!'

        self.mlen += len(m)
        m = self.buf + m

        for i in range(0, len(m) // 64):
            self.compress(m[64 * i : 64 * (i + 1)])

        self.buf = m[len(m) - (len(m) % 64):]

    def digest(self):
        if not self.fin:
            self.update(self.pad(self.mlen))
            self.digest = b''.join(x.to_bytes(4, 'big') for x in self.h[:8])
            self.fin = True
        return self.digest

    def hexdigest(self):
        tab = '0123456789abcdef'
        return ''.join(tab[b >> 4] + tab[b & 0xF] for b in self.digest())

def test():
    import secrets, hashlib, random
    for itest in range(500):
        data = secrets.token_bytes(random.randrange(257))
        a, b = hashlib.sha256(data).hexdigest(), Sha256(data).hexdigest()
        assert a == b, (a, b)
    for itest in range(500):
        a, b = hashlib.sha256(), Sha256()
        for j in range(random.randrange(10)):
            data = secrets.token_bytes(random.randrange(129))
            a.update(data)
            b.update(data)
        a, b = a.hexdigest(), b.hexdigest()
        assert a == b, (a, b)
    print('Sha256 tested successfully.')

if __name__ == '__main__':
    test()

    # block 000000000000000000021a4418065707fa7c22af1ce315212ae963c5c074ddc3
    # block 717068

    string = '04008020ba41ee8ae22c80860b8040873217b07dc62238868c4309000000000000000000405d819a0241c4380ccf6b3145b03c06f20f6e0782e71170c26cd6c43ae90bbba38cd361ab980b17c679095a'
    # convert to bytes and hash
    string = Sha256(bytes.fromhex(string)).hexdigest()
    print(string)
    # convert to bytes and hash second time
    string = Sha256(bytes.fromhex(string)).hexdigest()
    print(string)
    # invert byte order
    string = bytes.fromhex(string)[::-1]
    print(string.hex())
