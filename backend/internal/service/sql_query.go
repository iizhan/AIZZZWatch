package service

import (
	"context"
	"database/sql"
)

type sqlRowsQueryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

type sqlExecer interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func querySingleRow(ctx context.Context, queryer sqlRowsQueryer, query string, args []any, destinations ...any) error {
	rows, err := queryer.QueryContext(ctx, query, args...)
	if err != nil {
		return err
	}
	defer rows.Close()

	if !rows.Next() {
		if err := rows.Err(); err != nil {
			return err
		}
		return sql.ErrNoRows
	}
	if err := rows.Scan(destinations...); err != nil {
		return err
	}
	return rows.Err()
}
