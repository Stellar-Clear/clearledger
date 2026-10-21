# SDK invoice pagination

SDK pagination helpers expose a typed cursor iterator over contract pages. The
iterator advances the returned cursor and stops on an empty or short page,
avoiding duplicate records and unbounded fetches while preserving page-size
limits.
