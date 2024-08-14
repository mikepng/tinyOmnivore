import { GraphQLClient } from 'graphql-request'
import {
  QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { ContentReader, PageType, State } from '../fragments/articleFragment'
import { Highlight } from '../fragments/highlightFragment'
import { requestHeaders } from '../networkHelpers'
import { Label } from '../fragments/labelFragment'
import {
  GQL_BULK_ACTION,
  GQL_DELETE_LIBRARY_ITEM,
  GQL_GET_LIBRARY_ITEM,
  GQL_GET_LIBRARY_ITEM_CONTENT,
  GQL_MOVE_ITEM_TO_FOLDER,
  GQL_SAVE_ARTICLE_READING_PROGRESS,
  GQL_SAVE_URL,
  GQL_SEARCH_QUERY,
  GQL_SET_LABELS,
  GQL_SET_LINK_ARCHIVED,
  GQL_UPDATE_LIBRARY_ITEM,
} from './gql'
import { gqlEndpoint } from '../../appConfig'
import { useState } from 'react'

function gqlFetcher(
  query: string,
  variables?: unknown,
  requiresAuth = true
): Promise<unknown> {
  // if (requiresAuth) {
  //   verifyAuth()
  // }

  const graphQLClient = new GraphQLClient(gqlEndpoint, {
    credentials: 'include',
    mode: 'cors',
  })

  return graphQLClient.request(query, variables, requestHeaders())
}

const updateItemStateInCache = (
  queryClient: QueryClient,
  itemId: string,
  slug: string | undefined,
  newState: State
) => {
  updateItemPropertyInCache(queryClient, itemId, slug, 'state', newState)
}

function createDictionary(
  propertyName: string,
  value: any
): { [key: string]: any } {
  return {
    [propertyName]: value,
  }
}
const updateItemPropertyInCache = (
  queryClient: QueryClient,
  itemId: string,
  slug: string | undefined,
  propertyName: string,
  propertyValue: any
) => {
  updateItemProperty(queryClient, itemId, slug, (oldItem) => {
    const setter = createDictionary(propertyName, propertyValue)
    return {
      ...oldItem,
      ...setter,
    }
  })
}

export const updateItemProperty = (
  queryClient: QueryClient,
  itemId: string,
  slug: string | undefined,
  updateFunc: (input: ArticleAttributes) => ArticleAttributes
) => {
  let foundItemSlug: string | undefined
  const keys = queryClient
    .getQueryCache()
    .findAll({ queryKey: ['libraryItems'] })

  keys.forEach((query) => {
    queryClient.setQueryData(query.queryKey, (data: any) => {
      if (!data) return data
      const updatedData = {
        ...data,
        pages: data.pages.map((page: any) => ({
          ...page,
          edges: page.edges.map((edge: any) => {
            if (edge.node.id === itemId) {
              foundItemSlug = edge.node.slug
              return {
                ...edge,
                node: { ...edge.node, ...updateFunc(edge.node) },
              }
            }
            return edge
          }),
        })),
      }
      return updatedData
    })
  })
  if (foundItemSlug || slug) {
    queryClient.setQueryData(
      ['libraryItem', foundItemSlug ?? slug],
      (oldData: ArticleAttributes) => {
        return {
          ...oldData,
          ...updateFunc(oldData),
        }
      }
    )
  }
}

const overwriteItemPropertiesInCache = (
  queryClient: QueryClient,
  itemId: string,
  slug: string | undefined,
  item: any
) => {
  let foundItemSlug: string | undefined
  const keys = queryClient
    .getQueryCache()
    .findAll({ queryKey: ['libraryItems'] })
  keys.forEach((query) => {
    queryClient.setQueryData(query.queryKey, (data: any) => {
      if (!data) return data
      const updatedData = {
        ...data,
        pages: data.pages.map((page: any) => ({
          ...page,
          edges: page.edges.map((edge: any) => {
            if (edge.node.id === itemId) {
              foundItemSlug = edge.node.slug
              return {
                ...edge,
                node: { ...edge.node, ...item },
              }
            }
            return edge
          }),
        })),
      }
      return updatedData
    })
  })
  if (foundItemSlug || slug) {
    queryClient.setQueryData(
      ['libraryItem', foundItemSlug ?? slug],
      (oldData: ArticleAttributes) => {
        return {
          ...oldData,
          ...item,
        }
      }
    )
  }
}

export const insertItemInCache = (
  queryClient: QueryClient,
  itemId: string,
  url: string
) => {
  const keys = queryClient
    .getQueryCache()
    .findAll({ queryKey: ['libraryItems'] })
  console.log('keys: ', keys)

  keys.forEach((query) => {
    queryClient.setQueryData(query.queryKey, (data: any) => {
      console.log('data, data.pages', data)
      if (!data) return data
      if (data.pages.length > 0) {
        const firstPage = data.pages[0] as LibraryItems
        firstPage.edges = [
          ...firstPage.edges,
          {
            cursor: firstPage.pageInfo.endCursor,
            node: {
              id: itemId,
              title: url,
              url: url,
              originalArticleUrl: url,
              readingProgressPercent: 0,
              readingProgressAnchorIndex: 0,
              slug: url,
              folder: 'inbox',
              ownedByViewer: true,
              state: State.PROCESSING,
              pageType: PageType.UNKNOWN,
              createdAt: new Date().toISOString(),
            },
          },
        ]
        data.pages[0] = firstPage
        console.log('data: ', data)
        return data
      }
    })
  })
}

export function useGetLibraryItems(
  folder: string | undefined,
  { limit, searchQuery }: LibraryItemsQueryInput,
  enabled = true
) {
  const fullQuery = folder
    ? (`in:${folder} use:folders ` + (searchQuery ?? '')).trim()
    : searchQuery ?? ''

  return useInfiniteQuery({
    queryKey: ['libraryItems', fullQuery],
    queryFn: async ({ pageParam }) => {
      const response = (await gqlFetcher(GQL_SEARCH_QUERY, {
        after: pageParam,
        first: limit,
        query: fullQuery,
        includeContent: false,
      })) as LibraryItemsData
      return response.search
    },
    enabled,
    initialPageParam: '0',
    getNextPageParam: (lastPage: LibraryItems) => {
      return lastPage.pageInfo.hasNextPage
        ? lastPage?.pageInfo?.endCursor
        : undefined
    },
  })
}

export const useArchiveItem = () => {
  const queryClient = useQueryClient()
  const archiveItem = async (variables: {
    itemId: string
    slug: string
    input: SetLinkArchivedInput
  }) => {
    const result = (await gqlFetcher(GQL_SET_LINK_ARCHIVED, {
      input: variables.input,
    })) as SetLinkArchivedData
    if (result.errorCodes?.length) {
      throw new Error(result.errorCodes[0])
    }
    return result.setLinkArchived
  }
  return useMutation({
    mutationFn: archiveItem,
    onMutate: async (variables: {
      itemId: string
      slug: string
      input: SetLinkArchivedInput
    }) => {
      await queryClient.cancelQueries({ queryKey: ['libraryItems'] })
      const previousState = {
        previousDetail: queryClient.getQueryData([
          'libraryItem',
          variables.slug,
        ]),
        previousItems: queryClient.getQueryData(['libraryItems']),
      }

      updateItemStateInCache(
        queryClient,
        variables.itemId,
        variables.slug,
        variables.input.archived ? State.ARCHIVED : State.SUCCEEDED
      )

      return previousState
    },
    onError: (error, variables, context) => {
      if (context?.previousItems) {
        queryClient.setQueryData(['libraryItems'], context.previousItems)
      }
      if (context?.previousDetail) {
        queryClient.setQueryData(
          ['libraryItem', variables.slug],
          context.previousDetail
        )
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: ['libraryItems'],
      })
    },
  })
}

export const useDeleteItem = () => {
  const queryClient = useQueryClient()
  const deleteItem = async (variables: { itemId: string; slug: string }) => {
    const result = (await gqlFetcher(GQL_DELETE_LIBRARY_ITEM, {
      input: { articleID: variables.itemId, bookmark: false },
    })) as SetBookmarkArticleData
    if (result.setBookmarkArticle.errorCodes?.length) {
      throw new Error(result.setBookmarkArticle.errorCodes[0])
    }
    return result.setBookmarkArticle
  }
  return useMutation({
    mutationFn: deleteItem,
    onMutate: async (variables: { itemId: string; slug: string }) => {
      await queryClient.cancelQueries({ queryKey: ['libraryItems'] })
      const previousState = {
        previousDetail: queryClient.getQueryData([
          'libraryItem',
          variables.slug,
        ]),
        previousItems: queryClient.getQueryData(['libraryItems']),
      }
      updateItemStateInCache(
        queryClient,
        variables.itemId,
        variables.slug,
        State.DELETED
      )
      return previousState
    },
    onError: (error, variables, context) => {
      if (context?.previousItems) {
        queryClient.setQueryData(['libraryItems'], context.previousItems)
      }
      if (context?.previousDetail) {
        queryClient.setQueryData(
          ['libraryItem', variables.slug],
          context.previousDetail
        )
      }
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['libraryItems'],
      })
    },
  })
}

export const useRestoreItem = () => {
  const queryClient = useQueryClient()
  const restoreItem = async (variables: { itemId: string; slug: string }) => {
    const result = (await gqlFetcher(GQL_UPDATE_LIBRARY_ITEM, {
      input: { pageId: variables.itemId, state: State.SUCCEEDED },
    })) as UpdateLibraryItemData
    if (result.updatePage.errorCodes?.length) {
      throw new Error(result.updatePage.errorCodes[0])
    }
    return result.updatePage
  }
  return useMutation({
    mutationFn: restoreItem,
    onMutate: async (variables: { itemId: string; slug: string }) => {
      const previousState = {
        previousDetail: queryClient.getQueryData([
          'libraryItem',
          variables.slug,
        ]),
        previousItems: queryClient.getQueryData(['libraryItems']),
      }
      updateItemStateInCache(
        queryClient,
        variables.itemId,
        variables.slug,
        State.SUCCEEDED
      )
      return previousState
    },
    onError: (error, variables, context) => {
      if (context?.previousItems) {
        queryClient.setQueryData(['libraryItems'], context.previousItems)
      }
      if (context?.previousDetail) {
        queryClient.setQueryData(
          ['libraryItem', variables.slug],
          context.previousDetail
        )
      }
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['libraryItems'],
      })
    },
  })
}

export const useUpdateItem = () => {
  const queryClient = useQueryClient()
  const updateItem = async (variables: {
    itemId: string
    slug: string | undefined
    input: UpdateLibraryItemInput
  }) => {
    const result = (await gqlFetcher(GQL_UPDATE_LIBRARY_ITEM, {
      input: variables.input,
    })) as UpdateLibraryItemData
    if (result.updatePage.errorCodes?.length) {
      throw new Error(result.updatePage.errorCodes[0])
    }
    return result.updatePage
  }
  return useMutation({
    mutationFn: updateItem,
    onMutate: async (variables: {
      itemId: string
      slug: string | undefined
      input: UpdateLibraryItemInput
    }) => {
      const previousState = {
        previousDetail: queryClient.getQueryData([
          'libraryItem',
          variables.slug,
        ]),
        previousItems: queryClient.getQueryData(['libraryItems']),
      }
      overwriteItemPropertiesInCache(
        queryClient,
        variables.itemId,
        variables.slug,
        variables.input
      )
      return previousState
    },
    onError: (error, variables, context) => {
      if (context?.previousItems) {
        queryClient.setQueryData(['libraryItems'], context.previousItems)
      }
      if (context?.previousDetail) {
        queryClient.setQueryData(
          ['libraryItem', variables.slug],
          context.previousDetail
        )
      }
    },
    onSuccess: async (data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: ['libraryItems'],
      })
      await queryClient.invalidateQueries({
        queryKey: ['libraryItem', variables.slug],
      })
    },
  })
}

export const useUpdateItemReadStatus = () => {
  const queryClient = useQueryClient()
  const updateItemReadStatus = async (variables: {
    itemId: string
    slug: string
    input: ArticleReadingProgressMutationInput
  }) => {
    const result = (await gqlFetcher(GQL_SAVE_ARTICLE_READING_PROGRESS, {
      input: variables.input,
    })) as ArticleReadingProgressMutationData
    if (result.saveArticleReadingProgress.errorCodes?.length) {
      throw new Error(result.saveArticleReadingProgress.errorCodes[0])
    }
    return result.saveArticleReadingProgress.updatedArticle
  }
  return useMutation({
    mutationFn: updateItemReadStatus,
    onMutate: async (variables: {
      itemId: string
      slug: string
      input: ArticleReadingProgressMutationInput
    }) => {
      const previousState = {
        previousDetail: queryClient.getQueryData([
          'libraryItem',
          variables.slug,
        ]),
        previousItems: queryClient.getQueryData(['libraryItems']),
      }
      updateItemPropertyInCache(
        queryClient,
        variables.itemId,
        variables.slug,
        'readingProgressPercent',
        variables.input.readingProgressPercent
      )
      return previousState
    },
    onError: (error, variables, context) => {
      if (context?.previousItems) {
        queryClient.setQueryData(['libraryItems'], context.previousItems)
      }
      if (context?.previousDetail) {
        queryClient.setQueryData(
          ['libraryItem', variables.slug],
          context.previousDetail
        )
      }
    },
    onSuccess: (data, variables, context) => {
      if (data) {
        updateItemPropertyInCache(
          queryClient,
          variables.itemId,
          variables.slug,
          'readingProgressPercent',
          data.readingProgressPercent
        )
      }
    },
  })
}

export function useRefreshProcessingItems() {
  const maxAttempts = 3

  const delay = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms))

  const queryClient = useQueryClient()
  const refreshItems = async (variables: {
    attempt: number
    itemIds: string[]
  }) => {
    const fullQuery = `in:all includes:${variables.itemIds.join(',')}`
    const result = (await gqlFetcher(GQL_SEARCH_QUERY, {
      first: 10,
      query: fullQuery,
      includeContent: false,
    })) as LibraryItemsData
    if (result.search.errorCodes?.length) {
      return undefined
    }
    return result.search
  }
  const mutation = useMutation({
    mutationFn: refreshItems,
    retry: 3,
    retryDelay: 10,
    onSuccess: async (
      data: LibraryItems | undefined,
      variables: {
        attempt: number
        itemIds: string[]
      }
    ) => {
      let shouldRefetch = data == undefined
      if (data) {
        for (const item of data.edges) {
          if (item.node.state !== State.PROCESSING) {
            overwriteItemPropertiesInCache(
              queryClient,
              item.node.id,
              undefined,
              item.node
            )
          } else {
            shouldRefetch = true
          }
        }
      } else {
        shouldRefetch = true
      }
      if (shouldRefetch && variables.attempt < maxAttempts) {
        await delay(5000 * variables.attempt + 1)
        mutation.mutate({
          attempt: variables.attempt + 1,
          itemIds: data
            ? data.edges
                .filter((item) => item.node.state == State.PROCESSING)
                .map((it) => it.node.id)
            : variables.itemIds,
        })
      }
    },
  })
  return mutation
}

export const useGetLibraryItemContent = (username: string, slug: string) => {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: ['libraryItem', slug],
    queryFn: async () => {
      const response = (await gqlFetcher(GQL_GET_LIBRARY_ITEM_CONTENT, {
        slug,
        username,
        includeFriendsHighlights: false,
      })) as ArticleData
      if (response.article.errorCodes?.length) {
        throw new Error(response.article.errorCodes[0])
      }
      const article = response.article.article
      if (article) {
        overwriteItemPropertiesInCache(
          queryClient,
          article.id,
          article.slug,
          article
        )
      }
      return response.article.article
    },
  })
}

export const useMoveItemToFolder = () => {
  const queryClient = useQueryClient()
  const moveItem = async (variables: {
    itemId: string
    slug: string | undefined
    folder: string
  }) => {
    const result = (await gqlFetcher(GQL_MOVE_ITEM_TO_FOLDER, {
      id: variables.itemId,
      folder: variables.folder,
    })) as MoveToFolderData
    if (result.moveToFolder.errorCodes?.length) {
      throw new Error(result.moveToFolder.errorCodes[0])
    }
    return result.moveToFolder
  }
  return useMutation({
    mutationFn: moveItem,
    onMutate: async (variables: {
      itemId: string
      slug: string | undefined
      folder: string
    }) => {
      await queryClient.cancelQueries({ queryKey: ['libraryItems'] })
      const previousState = {
        previousDetail: queryClient.getQueryData([
          'libraryItem',
          variables.slug,
        ]),
        previousItems: queryClient.getQueryData(['libraryItems']),
      }
      updateItemPropertyInCache(
        queryClient,
        variables.itemId,
        variables.slug,
        'folder',
        variables.folder
      )
      return previousState
    },
    onError: (error, variables, context) => {
      if (context?.previousItems) {
        queryClient.setQueryData(['libraryItems'], context.previousItems)
      }
      if (context?.previousDetail) {
        queryClient.setQueryData(
          ['libraryItem', variables.slug],
          context.previousDetail
        )
      }
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['libraryItems'],
      })
    },
  })
}

export const useSetItemLabels = () => {
  const queryClient = useQueryClient()
  const setLabels = async (variables: {
    itemId: string
    slug: string | undefined
    labels: Label[]
  }) => {
    const labelIds = variables.labels.map((l) => l.id)
    const result = (await gqlFetcher(GQL_SET_LABELS, {
      input: { pageId: variables.itemId, labelIds },
    })) as SetLabelsData
    if (result.setLabels.errorCodes?.length) {
      throw new Error(result.setLabels.errorCodes[0])
    }
    return result.setLabels.labels
  }
  return useMutation({
    mutationFn: setLabels,
    onMutate: async (variables: {
      itemId: string
      slug: string | undefined
      labels: Label[]
    }) => {
      await queryClient.cancelQueries({ queryKey: ['libraryItems'] })
      const previousState = {
        previousDetail: queryClient.getQueryData([
          'libraryItem',
          variables.slug,
        ]),
        previousItems: queryClient.getQueryData(['libraryItems']),
      }
      updateItemPropertyInCache(
        queryClient,
        variables.itemId,
        variables.slug,
        'labels',
        variables.labels
      )
      return previousState
    },
    onError: (error, variables, context) => {
      if (context?.previousItems) {
        queryClient.setQueryData(['libraryItems'], context.previousItems)
      }
      if (context?.previousDetail) {
        queryClient.setQueryData(
          ['libraryItem', variables.slug],
          context.previousDetail
        )
      }
    },
    onSuccess: async (newLabels, variables) => {
      updateItemPropertyInCache(
        queryClient,
        variables.itemId,
        variables.slug,
        'labels',
        newLabels
      )
    },
  })
}

export const useAddItem = () => {
  const queryClient = useQueryClient()
  const addItem = async (variables: {
    itemId: string
    url: string
    timezone: string | undefined
    locale: string | undefined
  }) => {
    const result = (await gqlFetcher(GQL_SAVE_URL, {
      input: {
        clientRequestId: variables.itemId,
        url: variables.url,
        source: 'add-link',
        timezone: variables.timezone,
        locale: variables.locale,
      },
    })) as SaveUrlData
    if (result.saveUrl?.errorCodes?.length) {
      throw new Error(result.saveUrl.errorCodes[0])
    }
    return result.saveUrl?.clientRequestId
  }
  return useMutation({
    mutationFn: addItem,
    onMutate: async (variables: {
      itemId: string
      url: string
      timezone: string | undefined
      locale: string | undefined
    }) => {
      await queryClient.cancelQueries({ queryKey: ['libraryItems'] })
      const previousState = {
        previousItems: queryClient.getQueryData(['libraryItems']),
      }
      insertItemInCache(queryClient, variables.itemId, variables.url)
      return previousState
    },
    onError: (error, variables, context) => {
      if (context?.previousItems) {
        queryClient.setQueryData(['libraryItems'], context.previousItems)
      }
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['libraryItems'],
      })
    },
  })
}

export const useBulkActions = () => {
  const queryClient = useQueryClient()
  const bulkAction = async (variables: {
    action: BulkAction
    query: string
    expectedCount: number
    labelIds?: string[]
    arguments?: any
  }) => {
    const result = (await gqlFetcher(GQL_BULK_ACTION, {
      ...variables,
    })) as BulkActionData
    if (result.bulkAction?.errorCodes?.length) {
      throw new Error(result.bulkAction.errorCodes[0])
    }
    return result.bulkAction.success
  }
  return useMutation({
    mutationFn: bulkAction,
    onMutate: async (variables: {
      action: BulkAction
      query: string
      expectedCount: number
      labelIds?: string[]
    }) => {
      await queryClient.cancelQueries({ queryKey: ['libraryItems'] })
    },
    onSettled: async (newLabels, variables) => {
      await queryClient.invalidateQueries({
        queryKey: ['libraryItems'],
      })
    },
  })
}

export enum BulkAction {
  ARCHIVE = 'ARCHIVE',
  DELETE = 'DELETE',
  ADD_LABELS = 'ADD_LABELS',
  MARK_AS_READ = 'MARK_AS_READ',
  MOVE_TO_FOLDER = 'MOVE_TO_FOLDER',
}

type BulkActionResult = {
  success?: boolean
  errorCodes?: string[]
}

type BulkActionData = {
  bulkAction: BulkActionResult
}

export type SaveUrlResult = {
  id?: string
  url?: string
  slug?: string
  clientRequestId?: string
  errorCodes?: string[]
}

export type SaveUrlData = {
  saveUrl?: SaveUrlResult
}

type UpdateLibraryItemInput = {
  pageId: string
  title?: string
  byline?: string | undefined
  description?: string
  savedAt?: string
  publishedAt?: string
  state?: State
}

type SetLabelsData = {
  setLabels: SetLabelsResult
}

type SetLabelsResult = {
  labels?: Label[]
  errorCodes?: string[]
}

export type TextDirection = 'RTL' | 'LTR'

export type ArticleAttributes = {
  id: string
  title: string
  url: string
  originalArticleUrl: string
  author?: string
  image?: string
  savedAt: string
  createdAt: string
  publishedAt?: string
  description?: string
  wordsCount?: number
  originalHtml?: string
  contentReader: ContentReader
  readingProgressPercent: number
  readingProgressTopPercent?: number
  readingProgressAnchorIndex: number
  slug: string
  folder: string
  savedByViewer?: boolean
  content: string
  highlights: Highlight[]
  linkId: string
  labels?: Label[]
  state?: State
  directionality?: TextDirection
  recommendations?: Recommendation[]
}

type MoveToFolderData = {
  moveToFolder: MoveToFolderResult
}

type MoveToFolderResult = {
  success?: boolean
  errorCodes?: string[]
}

type ArticleResult = {
  article?: ArticleAttributes
  errorCodes?: string[]
}
type ArticleData = {
  article: ArticleResult
}

type ArticleReadingProgressUpdatedArticle = {
  id: string
  readingProgressPercent: number
  readingProgressAnchorIndex: string
}

type ArticleReadingProgressResult = {
  errorCodes?: string[]
  updatedArticle?: ArticleReadingProgressUpdatedArticle
}

type ArticleReadingProgressMutationData = {
  saveArticleReadingProgress: ArticleReadingProgressResult
}

export type ArticleReadingProgressMutationInput = {
  id: string
  force?: boolean
  readingProgressPercent?: number
  readingProgressTopPercent?: number
  readingProgressAnchorIndex?: number
}

export interface ReadableItem {
  id: string
  title: string
  slug: string
}

export type LibraryItemsQueryInput = {
  limit: number
  sortDescending: boolean
  searchQuery?: string
  cursor?: string
  includeContent?: boolean
}

type LibraryItemsData = {
  search: LibraryItems
  errorCodes?: string[]
}

export type LibraryItems = {
  edges: LibraryItem[]
  pageInfo: PageInfo
  errorCodes?: string[]
}

export type LibraryItem = {
  cursor: string
  node: LibraryItemNode
  isLoading?: boolean | undefined
}

export type LibraryItemNode = {
  id: string
  title: string
  url: string
  author?: string
  image?: string
  createdAt: string
  publishedAt?: string
  contentReader?: ContentReader
  originalArticleUrl: string
  readingProgressPercent: number
  readingProgressTopPercent?: number
  readingProgressAnchorIndex: number
  slug: string
  folder?: string
  state: State
  pageType: PageType
  description?: string
  ownedByViewer: boolean
  uploadFileId?: string
  labels?: Label[]
  pageId?: string
  shortId?: string
  quote?: string
  annotation?: string
  siteName?: string
  siteIcon?: string
  subscription?: string
  readAt?: string
  savedAt?: string
  wordsCount?: number
  aiSummary?: string
  recommendations?: Recommendation[]
  highlights?: Highlight[]
  highlightsCount?: number
}

export type Recommendation = {
  id: string
  name: string
  note?: string
  user?: RecommendingUser
  recommendedAt: Date
}

export type RecommendingUser = {
  userId: string
  name: string
  username: string
  profileImageURL?: string
}

export type PageInfo = {
  hasNextPage: boolean
  hasPreviousPage: boolean
  startCursor: string
  endCursor: string
  totalCount: number
}

type SetLinkArchivedInput = {
  linkId: string
  archived: boolean
}

type SetLinkArchivedSuccess = {
  linkId: string
  message?: string
}

type SetLinkArchivedData = {
  setLinkArchived: SetLinkArchivedSuccess
  errorCodes?: string[]
}

type SetBookmarkArticle = {
  errorCodes?: string[]
}

type SetBookmarkArticleData = {
  setBookmarkArticle: SetBookmarkArticle
}

type UpdateLibraryItem = {
  errorCodes?: string[]
}

type UpdateLibraryItemData = {
  updatePage: UpdateLibraryItem
}
