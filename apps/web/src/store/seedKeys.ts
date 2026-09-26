// Fixed keys for the SIMULATION's seeded devices (?device=maa|arjun|priya), generated once with the real
// security core (device IDs and safety words derived from these keys). Test fixtures only: this module is loaded
// only by simulation tabs, never by a real device, and these keys protect nothing.
// prettier-ignore
export const SEED_KEYS = {
  "maa": {
    "deviceId": "nGGY501nf3eklG3UqNqDeR",
    "sign": {
      "jwk": {
        "kty": "EC",
        "crv": "P-256",
        "x": "sxq4yjYCOAg_o6E_Fd0HBae_-0zc9yy-Z8bZAr58f6g",
        "y": "ZoseAkfgwLJ9mEqUmshFOj6rIocP_soZbPW_oGfQgEg",
        "d": "ZPNiNaXU7vUs5U0BmX-6xVLAdrA9rMz_QQwR7gYg0gM"
      },
      "raw": "BLMauMo2AjgIP6OhPxXdBwWnv_tM3PcsvmfG2QK-fH-oZoseAkfgwLJ9mEqUmshFOj6rIocP_soZbPW_oGfQgEg"
    },
    "enc": {
      "jwk": {
        "kty": "EC",
        "crv": "P-256",
        "x": "_twpKNF6GSZd5b79gMGRveKUZyY7geKN5fjwVlCFnLg",
        "y": "Tar3-heFfDM29BEluhfbBRGF0xw-gMQV02sU1xDoEKY",
        "d": "xwYxbJZrMbZsjlFPnHzKLuaps5npyKsfmWaQ5hiyCvQ"
      },
      "raw": "BP7cKSjRehkmXeW-_YDBkb3ilGcmO4HijeX48FZQhZy4Tar3-heFfDM29BEluhfbBRGF0xw-gMQV02sU1xDoEKY"
    },
    "grant": {
      "id": "54LU0D-Ovtw",
      "secret": "Ehpwd9b3xH5-Qzv-eJaGnw"
    },
    "safetyWords": [
      "DETECT",
      "ENFORCE",
      "FAINT",
      "BLACK"
    ]
  },
  "arjun": {
    "deviceId": "VaLa59Ymp40NZiBRu3ag_I",
    "sign": {
      "jwk": {
        "kty": "EC",
        "crv": "P-256",
        "x": "-Q5pVX3hqxjWR2VJdyJ1LM7zYRarr9orwDfK2bmQk8s",
        "y": "YDrb_uHWcxj8fwUwCpUwbHRglidE3UzY3NOtkO9Ma30",
        "d": "uKJqsINWP0R-sdRGaWKbsUVQ2lnNUXte0JOiFG1zTIU"
      },
      "raw": "BPkOaVV94asY1kdlSXcidSzO82EWq6_aK8A3ytm5kJPLYDrb_uHWcxj8fwUwCpUwbHRglidE3UzY3NOtkO9Ma30"
    },
    "enc": {
      "jwk": {
        "kty": "EC",
        "crv": "P-256",
        "x": "37ifkoMGONciC-aUYQNWA-w5RS8cWPo2Czph7slddpg",
        "y": "4cr-J6gjSJJJWAMBaOpBVgqSZwVtK7Z2mEh0vxs6VaU",
        "d": "p36S8CU1H0qUClxOguJytG4QB3snxUR3RmXDS9rcc8E"
      },
      "raw": "BN-4n5KDBjjXIgvmlGEDVgPsOUUvHFj6Ngs6Ye7JXXaY4cr-J6gjSJJJWAMBaOpBVgqSZwVtK7Z2mEh0vxs6VaU"
    },
    "grant": {
      "id": "stoTkgomUW4",
      "secret": "EZnIAZLO9hE7EdBbNIZ1tw"
    },
    "passkey": {
      "credId": "hKEOTkHlz6aJa-Iu8GBFgw",
      "jwk": {
        "kty": "EC",
        "crv": "P-256",
        "x": "KizHoN4Xth_Z6V-1KohY09-GSg1iDBw7txnbLCJmmFo",
        "y": "0Xqf_i4nu_K_x1huuI36VrPAUv4Z4O___i3SeeA6GC4",
        "d": "ysbYE3JtnVh3U50qmtgMnVh-vp1ohOXEk-Fr1Jy02Rg"
      },
      "raw": "BCosx6DeF7Yf2elftSqIWNPfhkoNYgwcO7cZ2ywiZpha0Xqf_i4nu_K_x1huuI36VrPAUv4Z4O___i3SeeA6GC4"
    },
    "safetyWords": [
      "RESIST",
      "ASPECT",
      "FIX",
      "SEVEN"
    ]
  },
  "priya": {
    "deviceId": "-Kg0-1YWjg2u2_4VAL4qMH",
    "sign": {
      "jwk": {
        "kty": "EC",
        "crv": "P-256",
        "x": "xPqDB2T8Ua6TviI9WlE_uSnp63wmreJ59LnjDfEzA_c",
        "y": "2WD6bDuut-h9ObuHHj_mFvCKhIeGy9oDaXwG1KALeI4",
        "d": "-8KoHPnICBfeUf6VyVhQjudOZ6HTSPZsOhn8-A5FcgQ"
      },
      "raw": "BMT6gwdk_FGuk74iPVpRP7kp6et8Jq3iefS54w3xMwP32WD6bDuut-h9ObuHHj_mFvCKhIeGy9oDaXwG1KALeI4"
    },
    "enc": {
      "jwk": {
        "kty": "EC",
        "crv": "P-256",
        "x": "prtMsxXEvCUQvbmz5gSsIhhz7S-xcbbc1CR7_CQoF7Y",
        "y": "sEipPBe8oFYBbO5nZ-BT0aFMo1r5B8eHYA0BMneTEsU",
        "d": "Axd82J7qsDnULhaSRSaPRtJVfVPGirWIbvqT2iDGz54"
      },
      "raw": "BKa7TLMVxLwlEL25s-YErCIYc-0vsXG23NQke_wkKBe2sEipPBe8oFYBbO5nZ-BT0aFMo1r5B8eHYA0BMneTEsU"
    },
    "grant": {
      "id": "-oy5MhNarwA",
      "secret": "MJZkcJxHgLdQ9A3pIXd4gw"
    },
    "passkey": {
      "credId": "izAq-gLhuYYd5XXGT9TKmQ",
      "jwk": {
        "kty": "EC",
        "crv": "P-256",
        "x": "HhqGqn9Mu7A7tVDyjys5mFgA11bpRmxcH6cFJWnNNcM",
        "y": "6jvQZ9hvnPHiqA-wD6fOSqPSj1YIMLK1wSqmjpvwDtQ",
        "d": "p3h-Gng-B4Q_c1XIZfCPBFYaVMk_bgeZOnZYnio3W9U"
      },
      "raw": "BB4ahqp_TLuwO7VQ8o8rOZhYANdW6UZsXB-nBSVpzTXD6jvQZ9hvnPHiqA-wD6fOSqPSj1YIMLK1wSqmjpvwDtQ"
    },
    "safetyWords": [
      "OWNER",
      "ALARM",
      "TREE",
      "SWEAR"
    ]
  },
  "ramesh": {
    "deviceId": "Fg1rNaIsDDmErixX4Viikw",
    "sign": {
      "jwk": {
        "kty": "EC",
        "crv": "P-256",
        "x": "ZryxOKQvazdTgoIA81HvCSlZqhrI14FzY9-NOV9df-g",
        "y": "Fjuo-P9Z2f7Wov8JZDaQ4HW3LCEwbwHEtlq0K1UaduM",
        "d": "TNHVEGlFBlynMT5QaPXWeumyZ1UlQim47FNDr5GdHio"
      },
      "raw": "BGa8sTikL2s3U4KCAPNR7wkpWaoayNeBc2PfjTlfXX_oFjuo-P9Z2f7Wov8JZDaQ4HW3LCEwbwHEtlq0K1UaduM"
    },
    "enc": {
      "jwk": {
        "kty": "EC",
        "crv": "P-256",
        "x": "7swSxtTQH5gxpjeBvXR0eVV3TSNV3VK-s5Mdep7Be9o",
        "y": "dnqQhulUUwGO7sweq4WrqrmHmOGmEvnKg5VKojd0CHA",
        "d": "mohYRQ4r6lSe9bPkiCtLhgOAOtLHGsW04iXeid2o7Eo"
      },
      "raw": "BO7MEsbU0B-YMaY3gb10dHlVd00jVd1SvrOTHXqewXvadnqQhulUUwGO7sweq4WrqrmHmOGmEvnKg5VKojd0CHA"
    },
    "grant": {
      "id": "mo9rkYokY2o",
      "secret": "r9z4mDHHPATe7l0-jq09Uw"
    },
    "safetyWords": [
      "ENGINE",
      "EYE",
      "DURING",
      "INFLICT"
    ]
  }
} as const;
