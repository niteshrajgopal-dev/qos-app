import * as React from "react";

export interface PaginationProps {
  page?: number;
  pageCount?: number;
  pageSize?: number;
  total?: number;
  onPageChange?: (page: number) => void;
}

export declare function Pagination(props: PaginationProps): JSX.Element;
