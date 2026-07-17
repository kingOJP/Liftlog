import './GlossaryView.css';

interface Props {
  onBack: () => void;
}

interface Term {
  term: string;
  def: string;
}

interface Group {
  heading: string;
  terms: Term[];
}

// Plain-language definitions of the vocabulary the app uses across the coach,
// metrics and journey. Written for someone new to structured training.
const GROUPS: Group[] = [
  {
    heading: 'Logging a workout',
    terms: [
      {
        term: 'Working set',
        def: 'A set taken close to failure that actually drives progress. Everything the coach measures — volume, strength, recommendations — is built from your working sets.',
      },
      {
        term: 'Warm-up set',
        def: 'A lighter set you do to prepare for your working sets. Tag it with the “Warm-up” button when logging. It’s saved so you can see it, but it’s left out of every metric and recommendation.',
      },
      {
        term: 'Rep',
        def: 'One complete repetition of an exercise. “3 × 8–12” means 3 sets of 8 to 12 reps each.',
      },
      {
        term: 'Rep range',
        def: 'The low–high target reps for a set (e.g. 8–12). Staying in range while adding reps or weight over time is how you progress.',
      },
      {
        term: 'Rest timer',
        def: 'The countdown that starts automatically after each working set, so you rest a consistent amount between sets.',
      },
    ],
  },
  {
    heading: 'Progress & strength',
    terms: [
      {
        term: 'Progressive overload',
        def: 'The core principle of getting stronger: gradually do more over time — more weight, more reps, or more sets — so your body keeps adapting.',
      },
      {
        term: 'Double progression',
        def: 'A simple way to progress: keep the weight until you can hit the top of the rep range on every set, then add weight and start climbing the range again.',
      },
      {
        term: 'Estimated 1RM (e1RM)',
        def: 'An estimate of the most you could lift for a single rep, calculated from the weight and reps you actually logged. A rising e1RM means you’re getting stronger, even if you never max out.',
      },
      {
        term: 'Volume load',
        def: 'Total weight moved in a session: weight × reps, added up. Also called tonnage. Rising volume load is progress even when your top weight hasn’t changed.',
      },
      {
        term: 'Personal record (PR)',
        def: 'Your best-ever performance on a lift. A weight PR is a new heaviest set; a rep PR is more reps than you’ve ever done at a given weight.',
      },
      {
        term: 'Plateau / stall',
        def: 'When a lift stops improving across several sessions. The coach watches for this and prescribes a deload to break through it.',
      },
    ],
  },
  {
    heading: 'Volume & muscles',
    terms: [
      {
        term: 'Hard set',
        def: 'A working set taken near failure. Weekly hard sets per muscle is the main dial for muscle growth.',
      },
      {
        term: 'Set volume (10–20 target)',
        def: 'How many hard sets a muscle gets per week. Roughly 10–20 sets per muscle weekly is the commonly cited sweet spot for building muscle — the coach aims your training at that band.',
      },
      {
        term: 'Primary vs secondary muscle',
        def: 'The main muscle an exercise trains (counts as a full set) versus the ones it works as support (counted as half a set). A bench press is primary chest, secondary shoulders and triceps.',
      },
      {
        term: 'Hypertrophy',
        def: 'Muscle growth — training to make muscles bigger, typically with moderate reps and enough weekly volume.',
      },
      {
        term: 'Muscle heatmap',
        def: 'The body diagram in Metrics, colored by how much each muscle has been trained recently — blue is undertrained, red is very high.',
      },
    ],
  },
  {
    heading: 'The training journey',
    terms: [
      {
        term: 'Program',
        def: 'Your set of workout days (e.g. Push / Pull / Legs), each with its own exercises, sets and rep ranges.',
      },
      {
        term: 'Training block (mesocycle)',
        def: 'A multi-week chunk of training with a plan and a purpose — usually a few weeks of building work followed by an easier week. Blocks stack up into your training journey.',
      },
      {
        term: 'Phase',
        def: 'The role a given week plays inside a block. Accumulation builds volume, intensification pushes heavier, peak tests strength, and deload/recovery weeks back off on purpose.',
      },
      {
        term: 'Deload',
        def: 'A planned easy week — lighter weights and less volume — that lets fatigue drain so you come back stronger. Not slacking; it’s part of the plan.',
      },
      {
        term: 'Foundation block',
        def: 'The open-ended starter block your earlier training is grouped into, so the coach can learn from everything you’ve already logged.',
      },
      {
        term: 'Retrospective',
        def: 'The summary the coach writes when a block ends — what improved, what stalled, and what to carry into the next block.',
      },
    ],
  },
  {
    heading: 'Coaching signals',
    terms: [
      {
        term: 'Experience level',
        def: 'Beginner, intermediate or advanced. It shapes how the coach picks exercises and dials volume — beginners get simpler, safer movements and gentler progression.',
      },
      {
        term: 'Training age',
        def: 'Roughly how long you’ve been training consistently. Combined with your logged data, it helps the coach judge your true experience level.',
      },
      {
        term: 'Priority muscles',
        def: 'Muscles you want to bring up. The coach biases a little extra weekly volume toward them.',
      },
      {
        term: 'Recommendation',
        def: 'The suggested weight (or reps) shown on each exercise when you start a workout, calculated from your recent history and the current phase.',
      },
    ],
  },
];

export default function GlossaryView({ onBack }: Props) {
  return (
    <div className="glossary-view">
      <header className="glossary-header">
        <button className="back-btn" onClick={onBack} aria-label="Back">&#8592;</button>
        <span className="glossary-title">Glossary</span>
      </header>

      <div className="glossary-body">
        <p className="glossary-intro">
          Strength training has its own vocabulary. Here’s what the terms across LiftLog mean —
          in plain English.
        </p>

        {GROUPS.map(group => (
          <section className="glossary-section" key={group.heading}>
            <h2 className="glossary-section-heading">{group.heading}</h2>
            <dl className="glossary-list">
              {group.terms.map(t => (
                <div className="glossary-item" key={t.term}>
                  <dt className="glossary-term">{t.term}</dt>
                  <dd className="glossary-def">{t.def}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}
