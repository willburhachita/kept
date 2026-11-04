"use client";

import { Button } from "@/components/ui/button";
import { errorCode, errorMessage } from "@/lib/errors";

export default function ContractError({ error, reset }: { error: Error; reset: () => void }) {
  const notFound = errorCode(error) === "NOT_FOUND" || /not found|not a valid id|ArgumentValidationError/i.test(error.message);
  return (
    <div className="mx-auto max-w-lg py-20 text-center">
      <p className="eyebrow">{notFound ? "(404) · Not found" : "Something went wrong"}</p>
      <h1 className="mt-4 text-3xl leading-tight tracking-[-0.045em]">{notFound ? "This promise doesn't exist, or it isn't yours to see." : "We couldn't load this promise."}</h1>
      <p className="mt-3 text-[15px] text-muted">{notFound ? "Only the two people on a promise (and an arbiter) can open it. If someone sent you this link, ask them for an invite link instead." : errorMessage(error)}</p>
      <div className="mt-8 flex justify-center gap-2">
        <Button href="/contracts">Your promises</Button>
        {!notFound && (
          <Button variant="secondary" onClick={reset}>
            Try again
          </Button>
        )}
      </div>
    </div>
  );
}
