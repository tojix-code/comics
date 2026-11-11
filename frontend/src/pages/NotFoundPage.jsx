import { Link } from 'react-router-dom';
import { EmptyState } from '../components/ui';

export default function NotFoundPage() {
  return (
    <main className="page">
      <EmptyState
        title="Page not found"
        body="That link doesn't exist in ComicVerse. It may have been a series that moved providers."
        action={<Link to="/" className="btn btn-primary">Go home</Link>}
      />
    </main>
  );
}
