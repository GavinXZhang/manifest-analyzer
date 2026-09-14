import { useParams } from 'react-router-dom';

/** Ported from the legacy lot page — see task 3.4. */
export function LotDetail() {
  const { id } = useParams();
  return (
    <main className="page">
      <h1>Lot {id}</h1>
      <div className="empty">Porting in progress.</div>
    </main>
  );
}
