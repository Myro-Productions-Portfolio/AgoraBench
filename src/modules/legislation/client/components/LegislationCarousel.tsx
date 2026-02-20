import { useState, useEffect } from 'react';
import { BillCard } from './BillCard';

interface CarouselBill {
  billNumber: string;
  title: string;
  summary: string;
  sponsor: string;
  committee: string;
  status: 'proposed' | 'committee' | 'floor' | 'passed' | 'law' | 'vetoed';
}

interface LegislationCarouselProps {
  bills: CarouselBill[];
}

const CARDS_PER_PAGE = 6;
const AUTO_ADVANCE_MS = 8000;

export function LegislationCarousel({ bills }: LegislationCarouselProps) {
  const [page, setPage] = useState(0);
  const [paused, setPaused] = useState(false);

  const totalPages = Math.max(1, Math.ceil(bills.length / CARDS_PER_PAGE));
  const safePage = Math.min(page, totalPages - 1);
  const visibleBills = bills.slice(safePage * CARDS_PER_PAGE, (safePage + 1) * CARDS_PER_PAGE);

  useEffect(() => {
    if (paused || totalPages <= 1) return;
    const id = setInterval(() => {
      setPage((prev) => (prev + 1) % totalPages);
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(id);
  }, [paused, totalPages]);

  if (bills.length === 0) {
    return (
      <div className="text-center py-12 text-text-muted">
        <p>No legislation has been introduced yet.</p>
      </div>
    );
  }

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
        {visibleBills.map((bill) => (
          <BillCard key={bill.billNumber} {...bill} />
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-5">
          <button
            onClick={() => setPage((p) => (p - 1 + totalPages) % totalPages)}
            className="text-text-muted hover:text-text-primary transition-colors px-2 text-lg leading-none"
            aria-label="Previous page"
          >
            &#8592;
          </button>

          <div className="flex gap-2 items-center">
            {Array.from({ length: totalPages }, (_, i) => (
              <button
                key={i}
                onClick={() => setPage(i)}
                className={`h-2 rounded-full transition-all duration-300 ${
                  i === safePage
                    ? 'w-4 bg-gold'
                    : 'w-2 bg-border hover:bg-text-muted'
                }`}
                aria-label={`Page ${i + 1}`}
              />
            ))}
          </div>

          <button
            onClick={() => setPage((p) => (p + 1) % totalPages)}
            className="text-text-muted hover:text-text-primary transition-colors px-2 text-lg leading-none"
            aria-label="Next page"
          >
            &#8594;
          </button>
        </div>
      )}
    </div>
  );
}
