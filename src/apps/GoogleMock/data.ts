export interface SearchResult {
  breadcrumb: string;
  title: string;
  snippet: string;
}

export interface SuggestedQuery {
  label: string;
  results: SearchResult[];
}

export const SUGGESTIONS: readonly SuggestedQuery[] = [
  {
    label: 'mediapipe hand tracking',
    results: [
      {
        breadcrumb: 'google.github.io › mediapipe › solutions › hands',
        title: 'Hand landmarks detection guide | MediaPipe',
        snippet:
          'The MediaPipe Hand Landmarker task lets you detect the landmarks of the hands in an image. Use this task to localize key points of the hands and render visual effects on them.',
      },
      {
        breadcrumb: 'github.com › google-ai-edge › mediapipe',
        title: 'google-ai-edge/mediapipe: Cross-platform, customizable ML...',
        snippet:
          'MediaPipe offers ready-to-use yet customizable Python solutions as a prebuilt Python package. You can install it with pip install mediapipe.',
      },
      {
        breadcrumb: 'developers.google.com › mediapipe › tasks › vision',
        title: 'Tasks Vision API reference',
        snippet:
          'HandLandmarker exposes detectForVideo() which runs on a <video> element every frame and returns 21 3D landmarks per hand — ideal for real-time gesture UIs.',
      },
    ],
  },
  {
    label: 'apple vision pro gestures',
    results: [
      {
        breadcrumb: 'developer.apple.com › design › human-interface-guidelines › gestures',
        title: 'Gestures — visionOS — Human Interface Guidelines',
        snippet:
          'People use their eyes to target an element, then pinch fingers together to select it. Drag, rotate, and zoom extend the same basic pinch language.',
      },
      {
        breadcrumb: 'apple.com › apple-vision-pro',
        title: 'Apple Vision Pro',
        snippet:
          'Your eyes, hands, and voice are all you need. Look at an app, pinch to select, and flick your wrist to scroll — no controllers required.',
      },
      {
        breadcrumb: 'theverge.com › 24073878 › apple-vision-pro-review',
        title: 'Apple Vision Pro review: magic, until it’s not',
        snippet:
          'Eye-and-pinch is astonishingly reliable in a quiet room. It falls apart the moment you add a second person, a bright window, or a long session.',
      },
    ],
  },
  {
    label: 'best pizza nyc 2026',
    results: [
      {
        breadcrumb: 'eater.com › maps › best-pizza-nyc',
        title: '23 Essential New York Pizzerias — Eater NY',
        snippet:
          'From the deep-dish revival at L’Industrie to the still-unrivaled margherita at Una Pizza Napoletana, these are the slices worth lining up for right now.',
      },
      {
        breadcrumb: 'reddit.com › r/FoodNYC › best_pizza_thread_2026',
        title: 'Best pizza in NYC — 2026 consolidated thread : r/FoodNYC',
        snippet:
          'Mega-thread collecting reader votes for the top slice joints across all five boroughs. L’Industrie, Scarr’s, and Mama’s Too still lead Manhattan.',
      },
      {
        breadcrumb: 'nytimes.com › dining › where-to-eat-pizza-new-york',
        title: 'Where to Eat Pizza in New York Right Now',
        snippet:
          'Pete Wells surveys a city where the line between slice shop and tasting menu has finally, thoroughly blurred.',
      },
    ],
  },
  {
    label: 'webgl gaussian blur shader',
    results: [
      {
        breadcrumb: 'learnopengl.com › Advanced-Lighting › Bloom',
        title: 'Bloom — LearnOpenGL',
        snippet:
          'A two-pass separable Gaussian blur is dramatically faster than a single 2D kernel. First blur horizontally into a ping-pong framebuffer, then vertically back.',
      },
      {
        breadcrumb: 'github.com › Jam3 › glsl-fast-gaussian-blur',
        title: 'Jam3/glsl-fast-gaussian-blur: Fast gaussian blur in GLSL',
        snippet:
          'Pre-computed 5 / 9 / 13-tap separable kernels for WebGL1 and WebGL2. Drop-in replacement for CSS filter: blur() with 3–5× the throughput on mid GPUs.',
      },
      {
        breadcrumb: 'github.com › mrdoob › three.js › examples',
        title: 'three.js / examples / webgl_postprocessing_gaussian',
        snippet:
          'Demonstrates how to chain horizontal + vertical blur passes using EffectComposer. Useful reference even outside of three.js.',
      },
    ],
  },
  {
    label: 'tailwind dark glass ui',
    results: [
      {
        breadcrumb: 'tailwindcss.com › docs › backdrop-blur',
        title: 'Backdrop Blur — Tailwind CSS',
        snippet:
          'Use backdrop-blur-md combined with a translucent bg-white/5 and a 1px border-white/10 to get the canonical macOS / visionOS glass look.',
      },
      {
        breadcrumb: 'ui.shadcn.com › docs › components › card',
        title: 'Card — shadcn/ui',
        snippet:
          'Recipes for translucent card surfaces over blurred backgrounds. Includes accessibility notes for contrast over dynamic video.',
      },
      {
        breadcrumb: 'css-tricks.com › the-backdrop-filter-css-property',
        title: 'The backdrop-filter CSS property — CSS-Tricks',
        snippet:
          'Pairs well with a saturate(160%) boost so video underlays keep their color punch when blurred.',
      },
    ],
  },
];

export const SUGGESTION_LABELS = SUGGESTIONS.map((s) => s.label);

export function resultsFor(query: string): SearchResult[] {
  const match = SUGGESTIONS.find((s) => s.label === query);
  return match ? match.results : [];
}
