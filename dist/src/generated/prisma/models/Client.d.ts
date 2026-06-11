import type * as runtime from "@prisma/client/runtime/client";
import type * as Prisma from "../internal/prismaNamespace.js";
export type ClientModel = runtime.Types.Result.DefaultSelection<Prisma.$ClientPayload>;
export type AggregateClient = {
    _count: ClientCountAggregateOutputType | null;
    _avg: ClientAvgAggregateOutputType | null;
    _sum: ClientSumAggregateOutputType | null;
    _min: ClientMinAggregateOutputType | null;
    _max: ClientMaxAggregateOutputType | null;
};
export type ClientAvgAggregateOutputType = {
    id: number | null;
};
export type ClientSumAggregateOutputType = {
    id: number | null;
};
export type ClientMinAggregateOutputType = {
    id: number | null;
    businessName: string | null;
    contactName: string | null;
    email: string | null;
    phone: string | null;
    industry: string | null;
    createdAt: Date | null;
    updatedAt: Date | null;
};
export type ClientMaxAggregateOutputType = {
    id: number | null;
    businessName: string | null;
    contactName: string | null;
    email: string | null;
    phone: string | null;
    industry: string | null;
    createdAt: Date | null;
    updatedAt: Date | null;
};
export type ClientCountAggregateOutputType = {
    id: number;
    businessName: number;
    contactName: number;
    email: number;
    phone: number;
    industry: number;
    createdAt: number;
    updatedAt: number;
    _all: number;
};
export type ClientAvgAggregateInputType = {
    id?: true;
};
export type ClientSumAggregateInputType = {
    id?: true;
};
export type ClientMinAggregateInputType = {
    id?: true;
    businessName?: true;
    contactName?: true;
    email?: true;
    phone?: true;
    industry?: true;
    createdAt?: true;
    updatedAt?: true;
};
export type ClientMaxAggregateInputType = {
    id?: true;
    businessName?: true;
    contactName?: true;
    email?: true;
    phone?: true;
    industry?: true;
    createdAt?: true;
    updatedAt?: true;
};
export type ClientCountAggregateInputType = {
    id?: true;
    businessName?: true;
    contactName?: true;
    email?: true;
    phone?: true;
    industry?: true;
    createdAt?: true;
    updatedAt?: true;
    _all?: true;
};
export type ClientAggregateArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    where?: Prisma.ClientWhereInput;
    orderBy?: Prisma.ClientOrderByWithRelationInput | Prisma.ClientOrderByWithRelationInput[];
    cursor?: Prisma.ClientWhereUniqueInput;
    take?: number;
    skip?: number;
    _count?: true | ClientCountAggregateInputType;
    _avg?: ClientAvgAggregateInputType;
    _sum?: ClientSumAggregateInputType;
    _min?: ClientMinAggregateInputType;
    _max?: ClientMaxAggregateInputType;
};
export type GetClientAggregateType<T extends ClientAggregateArgs> = {
    [P in keyof T & keyof AggregateClient]: P extends '_count' | 'count' ? T[P] extends true ? number : Prisma.GetScalarType<T[P], AggregateClient[P]> : Prisma.GetScalarType<T[P], AggregateClient[P]>;
};
export type ClientGroupByArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    where?: Prisma.ClientWhereInput;
    orderBy?: Prisma.ClientOrderByWithAggregationInput | Prisma.ClientOrderByWithAggregationInput[];
    by: Prisma.ClientScalarFieldEnum[] | Prisma.ClientScalarFieldEnum;
    having?: Prisma.ClientScalarWhereWithAggregatesInput;
    take?: number;
    skip?: number;
    _count?: ClientCountAggregateInputType | true;
    _avg?: ClientAvgAggregateInputType;
    _sum?: ClientSumAggregateInputType;
    _min?: ClientMinAggregateInputType;
    _max?: ClientMaxAggregateInputType;
};
export type ClientGroupByOutputType = {
    id: number;
    businessName: string;
    contactName: string;
    email: string;
    phone: string | null;
    industry: string | null;
    createdAt: Date;
    updatedAt: Date;
    _count: ClientCountAggregateOutputType | null;
    _avg: ClientAvgAggregateOutputType | null;
    _sum: ClientSumAggregateOutputType | null;
    _min: ClientMinAggregateOutputType | null;
    _max: ClientMaxAggregateOutputType | null;
};
export type GetClientGroupByPayload<T extends ClientGroupByArgs> = Prisma.PrismaPromise<Array<Prisma.PickEnumerable<ClientGroupByOutputType, T['by']> & {
    [P in ((keyof T) & (keyof ClientGroupByOutputType))]: P extends '_count' ? T[P] extends boolean ? number : Prisma.GetScalarType<T[P], ClientGroupByOutputType[P]> : Prisma.GetScalarType<T[P], ClientGroupByOutputType[P]>;
}>>;
export type ClientWhereInput = {
    AND?: Prisma.ClientWhereInput | Prisma.ClientWhereInput[];
    OR?: Prisma.ClientWhereInput[];
    NOT?: Prisma.ClientWhereInput | Prisma.ClientWhereInput[];
    id?: Prisma.IntFilter<"Client"> | number;
    businessName?: Prisma.StringFilter<"Client"> | string;
    contactName?: Prisma.StringFilter<"Client"> | string;
    email?: Prisma.StringFilter<"Client"> | string;
    phone?: Prisma.StringNullableFilter<"Client"> | string | null;
    industry?: Prisma.StringNullableFilter<"Client"> | string | null;
    createdAt?: Prisma.DateTimeFilter<"Client"> | Date | string;
    updatedAt?: Prisma.DateTimeFilter<"Client"> | Date | string;
    assignments?: Prisma.AssignmentListRelationFilter;
    tasks?: Prisma.TaskListRelationFilter;
};
export type ClientOrderByWithRelationInput = {
    id?: Prisma.SortOrder;
    businessName?: Prisma.SortOrder;
    contactName?: Prisma.SortOrder;
    email?: Prisma.SortOrder;
    phone?: Prisma.SortOrderInput | Prisma.SortOrder;
    industry?: Prisma.SortOrderInput | Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
    updatedAt?: Prisma.SortOrder;
    assignments?: Prisma.AssignmentOrderByRelationAggregateInput;
    tasks?: Prisma.TaskOrderByRelationAggregateInput;
    _relevance?: Prisma.ClientOrderByRelevanceInput;
};
export type ClientWhereUniqueInput = Prisma.AtLeast<{
    id?: number;
    email?: string;
    AND?: Prisma.ClientWhereInput | Prisma.ClientWhereInput[];
    OR?: Prisma.ClientWhereInput[];
    NOT?: Prisma.ClientWhereInput | Prisma.ClientWhereInput[];
    businessName?: Prisma.StringFilter<"Client"> | string;
    contactName?: Prisma.StringFilter<"Client"> | string;
    phone?: Prisma.StringNullableFilter<"Client"> | string | null;
    industry?: Prisma.StringNullableFilter<"Client"> | string | null;
    createdAt?: Prisma.DateTimeFilter<"Client"> | Date | string;
    updatedAt?: Prisma.DateTimeFilter<"Client"> | Date | string;
    assignments?: Prisma.AssignmentListRelationFilter;
    tasks?: Prisma.TaskListRelationFilter;
}, "id" | "email">;
export type ClientOrderByWithAggregationInput = {
    id?: Prisma.SortOrder;
    businessName?: Prisma.SortOrder;
    contactName?: Prisma.SortOrder;
    email?: Prisma.SortOrder;
    phone?: Prisma.SortOrderInput | Prisma.SortOrder;
    industry?: Prisma.SortOrderInput | Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
    updatedAt?: Prisma.SortOrder;
    _count?: Prisma.ClientCountOrderByAggregateInput;
    _avg?: Prisma.ClientAvgOrderByAggregateInput;
    _max?: Prisma.ClientMaxOrderByAggregateInput;
    _min?: Prisma.ClientMinOrderByAggregateInput;
    _sum?: Prisma.ClientSumOrderByAggregateInput;
};
export type ClientScalarWhereWithAggregatesInput = {
    AND?: Prisma.ClientScalarWhereWithAggregatesInput | Prisma.ClientScalarWhereWithAggregatesInput[];
    OR?: Prisma.ClientScalarWhereWithAggregatesInput[];
    NOT?: Prisma.ClientScalarWhereWithAggregatesInput | Prisma.ClientScalarWhereWithAggregatesInput[];
    id?: Prisma.IntWithAggregatesFilter<"Client"> | number;
    businessName?: Prisma.StringWithAggregatesFilter<"Client"> | string;
    contactName?: Prisma.StringWithAggregatesFilter<"Client"> | string;
    email?: Prisma.StringWithAggregatesFilter<"Client"> | string;
    phone?: Prisma.StringNullableWithAggregatesFilter<"Client"> | string | null;
    industry?: Prisma.StringNullableWithAggregatesFilter<"Client"> | string | null;
    createdAt?: Prisma.DateTimeWithAggregatesFilter<"Client"> | Date | string;
    updatedAt?: Prisma.DateTimeWithAggregatesFilter<"Client"> | Date | string;
};
export type ClientCreateInput = {
    businessName: string;
    contactName: string;
    email: string;
    phone?: string | null;
    industry?: string | null;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    assignments?: Prisma.AssignmentCreateNestedManyWithoutClientInput;
    tasks?: Prisma.TaskCreateNestedManyWithoutClientInput;
};
export type ClientUncheckedCreateInput = {
    id?: number;
    businessName: string;
    contactName: string;
    email: string;
    phone?: string | null;
    industry?: string | null;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    assignments?: Prisma.AssignmentUncheckedCreateNestedManyWithoutClientInput;
    tasks?: Prisma.TaskUncheckedCreateNestedManyWithoutClientInput;
};
export type ClientUpdateInput = {
    businessName?: Prisma.StringFieldUpdateOperationsInput | string;
    contactName?: Prisma.StringFieldUpdateOperationsInput | string;
    email?: Prisma.StringFieldUpdateOperationsInput | string;
    phone?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    industry?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    assignments?: Prisma.AssignmentUpdateManyWithoutClientNestedInput;
    tasks?: Prisma.TaskUpdateManyWithoutClientNestedInput;
};
export type ClientUncheckedUpdateInput = {
    id?: Prisma.IntFieldUpdateOperationsInput | number;
    businessName?: Prisma.StringFieldUpdateOperationsInput | string;
    contactName?: Prisma.StringFieldUpdateOperationsInput | string;
    email?: Prisma.StringFieldUpdateOperationsInput | string;
    phone?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    industry?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    assignments?: Prisma.AssignmentUncheckedUpdateManyWithoutClientNestedInput;
    tasks?: Prisma.TaskUncheckedUpdateManyWithoutClientNestedInput;
};
export type ClientCreateManyInput = {
    id?: number;
    businessName: string;
    contactName: string;
    email: string;
    phone?: string | null;
    industry?: string | null;
    createdAt?: Date | string;
    updatedAt?: Date | string;
};
export type ClientUpdateManyMutationInput = {
    businessName?: Prisma.StringFieldUpdateOperationsInput | string;
    contactName?: Prisma.StringFieldUpdateOperationsInput | string;
    email?: Prisma.StringFieldUpdateOperationsInput | string;
    phone?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    industry?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type ClientUncheckedUpdateManyInput = {
    id?: Prisma.IntFieldUpdateOperationsInput | number;
    businessName?: Prisma.StringFieldUpdateOperationsInput | string;
    contactName?: Prisma.StringFieldUpdateOperationsInput | string;
    email?: Prisma.StringFieldUpdateOperationsInput | string;
    phone?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    industry?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type ClientOrderByRelevanceInput = {
    fields: Prisma.ClientOrderByRelevanceFieldEnum | Prisma.ClientOrderByRelevanceFieldEnum[];
    sort: Prisma.SortOrder;
    search: string;
};
export type ClientCountOrderByAggregateInput = {
    id?: Prisma.SortOrder;
    businessName?: Prisma.SortOrder;
    contactName?: Prisma.SortOrder;
    email?: Prisma.SortOrder;
    phone?: Prisma.SortOrder;
    industry?: Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
    updatedAt?: Prisma.SortOrder;
};
export type ClientAvgOrderByAggregateInput = {
    id?: Prisma.SortOrder;
};
export type ClientMaxOrderByAggregateInput = {
    id?: Prisma.SortOrder;
    businessName?: Prisma.SortOrder;
    contactName?: Prisma.SortOrder;
    email?: Prisma.SortOrder;
    phone?: Prisma.SortOrder;
    industry?: Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
    updatedAt?: Prisma.SortOrder;
};
export type ClientMinOrderByAggregateInput = {
    id?: Prisma.SortOrder;
    businessName?: Prisma.SortOrder;
    contactName?: Prisma.SortOrder;
    email?: Prisma.SortOrder;
    phone?: Prisma.SortOrder;
    industry?: Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
    updatedAt?: Prisma.SortOrder;
};
export type ClientSumOrderByAggregateInput = {
    id?: Prisma.SortOrder;
};
export type ClientScalarRelationFilter = {
    is?: Prisma.ClientWhereInput;
    isNot?: Prisma.ClientWhereInput;
};
export type NullableStringFieldUpdateOperationsInput = {
    set?: string | null;
};
export type ClientCreateNestedOneWithoutAssignmentsInput = {
    create?: Prisma.XOR<Prisma.ClientCreateWithoutAssignmentsInput, Prisma.ClientUncheckedCreateWithoutAssignmentsInput>;
    connectOrCreate?: Prisma.ClientCreateOrConnectWithoutAssignmentsInput;
    connect?: Prisma.ClientWhereUniqueInput;
};
export type ClientUpdateOneRequiredWithoutAssignmentsNestedInput = {
    create?: Prisma.XOR<Prisma.ClientCreateWithoutAssignmentsInput, Prisma.ClientUncheckedCreateWithoutAssignmentsInput>;
    connectOrCreate?: Prisma.ClientCreateOrConnectWithoutAssignmentsInput;
    upsert?: Prisma.ClientUpsertWithoutAssignmentsInput;
    connect?: Prisma.ClientWhereUniqueInput;
    update?: Prisma.XOR<Prisma.XOR<Prisma.ClientUpdateToOneWithWhereWithoutAssignmentsInput, Prisma.ClientUpdateWithoutAssignmentsInput>, Prisma.ClientUncheckedUpdateWithoutAssignmentsInput>;
};
export type ClientCreateNestedOneWithoutTasksInput = {
    create?: Prisma.XOR<Prisma.ClientCreateWithoutTasksInput, Prisma.ClientUncheckedCreateWithoutTasksInput>;
    connectOrCreate?: Prisma.ClientCreateOrConnectWithoutTasksInput;
    connect?: Prisma.ClientWhereUniqueInput;
};
export type ClientUpdateOneRequiredWithoutTasksNestedInput = {
    create?: Prisma.XOR<Prisma.ClientCreateWithoutTasksInput, Prisma.ClientUncheckedCreateWithoutTasksInput>;
    connectOrCreate?: Prisma.ClientCreateOrConnectWithoutTasksInput;
    upsert?: Prisma.ClientUpsertWithoutTasksInput;
    connect?: Prisma.ClientWhereUniqueInput;
    update?: Prisma.XOR<Prisma.XOR<Prisma.ClientUpdateToOneWithWhereWithoutTasksInput, Prisma.ClientUpdateWithoutTasksInput>, Prisma.ClientUncheckedUpdateWithoutTasksInput>;
};
export type ClientCreateWithoutAssignmentsInput = {
    businessName: string;
    contactName: string;
    email: string;
    phone?: string | null;
    industry?: string | null;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    tasks?: Prisma.TaskCreateNestedManyWithoutClientInput;
};
export type ClientUncheckedCreateWithoutAssignmentsInput = {
    id?: number;
    businessName: string;
    contactName: string;
    email: string;
    phone?: string | null;
    industry?: string | null;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    tasks?: Prisma.TaskUncheckedCreateNestedManyWithoutClientInput;
};
export type ClientCreateOrConnectWithoutAssignmentsInput = {
    where: Prisma.ClientWhereUniqueInput;
    create: Prisma.XOR<Prisma.ClientCreateWithoutAssignmentsInput, Prisma.ClientUncheckedCreateWithoutAssignmentsInput>;
};
export type ClientUpsertWithoutAssignmentsInput = {
    update: Prisma.XOR<Prisma.ClientUpdateWithoutAssignmentsInput, Prisma.ClientUncheckedUpdateWithoutAssignmentsInput>;
    create: Prisma.XOR<Prisma.ClientCreateWithoutAssignmentsInput, Prisma.ClientUncheckedCreateWithoutAssignmentsInput>;
    where?: Prisma.ClientWhereInput;
};
export type ClientUpdateToOneWithWhereWithoutAssignmentsInput = {
    where?: Prisma.ClientWhereInput;
    data: Prisma.XOR<Prisma.ClientUpdateWithoutAssignmentsInput, Prisma.ClientUncheckedUpdateWithoutAssignmentsInput>;
};
export type ClientUpdateWithoutAssignmentsInput = {
    businessName?: Prisma.StringFieldUpdateOperationsInput | string;
    contactName?: Prisma.StringFieldUpdateOperationsInput | string;
    email?: Prisma.StringFieldUpdateOperationsInput | string;
    phone?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    industry?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    tasks?: Prisma.TaskUpdateManyWithoutClientNestedInput;
};
export type ClientUncheckedUpdateWithoutAssignmentsInput = {
    id?: Prisma.IntFieldUpdateOperationsInput | number;
    businessName?: Prisma.StringFieldUpdateOperationsInput | string;
    contactName?: Prisma.StringFieldUpdateOperationsInput | string;
    email?: Prisma.StringFieldUpdateOperationsInput | string;
    phone?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    industry?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    tasks?: Prisma.TaskUncheckedUpdateManyWithoutClientNestedInput;
};
export type ClientCreateWithoutTasksInput = {
    businessName: string;
    contactName: string;
    email: string;
    phone?: string | null;
    industry?: string | null;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    assignments?: Prisma.AssignmentCreateNestedManyWithoutClientInput;
};
export type ClientUncheckedCreateWithoutTasksInput = {
    id?: number;
    businessName: string;
    contactName: string;
    email: string;
    phone?: string | null;
    industry?: string | null;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    assignments?: Prisma.AssignmentUncheckedCreateNestedManyWithoutClientInput;
};
export type ClientCreateOrConnectWithoutTasksInput = {
    where: Prisma.ClientWhereUniqueInput;
    create: Prisma.XOR<Prisma.ClientCreateWithoutTasksInput, Prisma.ClientUncheckedCreateWithoutTasksInput>;
};
export type ClientUpsertWithoutTasksInput = {
    update: Prisma.XOR<Prisma.ClientUpdateWithoutTasksInput, Prisma.ClientUncheckedUpdateWithoutTasksInput>;
    create: Prisma.XOR<Prisma.ClientCreateWithoutTasksInput, Prisma.ClientUncheckedCreateWithoutTasksInput>;
    where?: Prisma.ClientWhereInput;
};
export type ClientUpdateToOneWithWhereWithoutTasksInput = {
    where?: Prisma.ClientWhereInput;
    data: Prisma.XOR<Prisma.ClientUpdateWithoutTasksInput, Prisma.ClientUncheckedUpdateWithoutTasksInput>;
};
export type ClientUpdateWithoutTasksInput = {
    businessName?: Prisma.StringFieldUpdateOperationsInput | string;
    contactName?: Prisma.StringFieldUpdateOperationsInput | string;
    email?: Prisma.StringFieldUpdateOperationsInput | string;
    phone?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    industry?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    assignments?: Prisma.AssignmentUpdateManyWithoutClientNestedInput;
};
export type ClientUncheckedUpdateWithoutTasksInput = {
    id?: Prisma.IntFieldUpdateOperationsInput | number;
    businessName?: Prisma.StringFieldUpdateOperationsInput | string;
    contactName?: Prisma.StringFieldUpdateOperationsInput | string;
    email?: Prisma.StringFieldUpdateOperationsInput | string;
    phone?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    industry?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    assignments?: Prisma.AssignmentUncheckedUpdateManyWithoutClientNestedInput;
};
export type ClientCountOutputType = {
    assignments: number;
    tasks: number;
};
export type ClientCountOutputTypeSelect<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    assignments?: boolean | ClientCountOutputTypeCountAssignmentsArgs;
    tasks?: boolean | ClientCountOutputTypeCountTasksArgs;
};
export type ClientCountOutputTypeDefaultArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.ClientCountOutputTypeSelect<ExtArgs> | null;
};
export type ClientCountOutputTypeCountAssignmentsArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    where?: Prisma.AssignmentWhereInput;
};
export type ClientCountOutputTypeCountTasksArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    where?: Prisma.TaskWhereInput;
};
export type ClientSelect<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = runtime.Types.Extensions.GetSelect<{
    id?: boolean;
    businessName?: boolean;
    contactName?: boolean;
    email?: boolean;
    phone?: boolean;
    industry?: boolean;
    createdAt?: boolean;
    updatedAt?: boolean;
    assignments?: boolean | Prisma.Client$assignmentsArgs<ExtArgs>;
    tasks?: boolean | Prisma.Client$tasksArgs<ExtArgs>;
    _count?: boolean | Prisma.ClientCountOutputTypeDefaultArgs<ExtArgs>;
}, ExtArgs["result"]["client"]>;
export type ClientSelectScalar = {
    id?: boolean;
    businessName?: boolean;
    contactName?: boolean;
    email?: boolean;
    phone?: boolean;
    industry?: boolean;
    createdAt?: boolean;
    updatedAt?: boolean;
};
export type ClientOmit<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = runtime.Types.Extensions.GetOmit<"id" | "businessName" | "contactName" | "email" | "phone" | "industry" | "createdAt" | "updatedAt", ExtArgs["result"]["client"]>;
export type ClientInclude<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    assignments?: boolean | Prisma.Client$assignmentsArgs<ExtArgs>;
    tasks?: boolean | Prisma.Client$tasksArgs<ExtArgs>;
    _count?: boolean | Prisma.ClientCountOutputTypeDefaultArgs<ExtArgs>;
};
export type $ClientPayload<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    name: "Client";
    objects: {
        assignments: Prisma.$AssignmentPayload<ExtArgs>[];
        tasks: Prisma.$TaskPayload<ExtArgs>[];
    };
    scalars: runtime.Types.Extensions.GetPayloadResult<{
        id: number;
        businessName: string;
        contactName: string;
        email: string;
        phone: string | null;
        industry: string | null;
        createdAt: Date;
        updatedAt: Date;
    }, ExtArgs["result"]["client"]>;
    composites: {};
};
export type ClientGetPayload<S extends boolean | null | undefined | ClientDefaultArgs> = runtime.Types.Result.GetResult<Prisma.$ClientPayload, S>;
export type ClientCountArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = Omit<ClientFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
    select?: ClientCountAggregateInputType | true;
};
export interface ClientDelegate<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: {
        types: Prisma.TypeMap<ExtArgs>['model']['Client'];
        meta: {
            name: 'Client';
        };
    };
    findUnique<T extends ClientFindUniqueArgs>(args: Prisma.SelectSubset<T, ClientFindUniqueArgs<ExtArgs>>): Prisma.Prisma__ClientClient<runtime.Types.Result.GetResult<Prisma.$ClientPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>;
    findUniqueOrThrow<T extends ClientFindUniqueOrThrowArgs>(args: Prisma.SelectSubset<T, ClientFindUniqueOrThrowArgs<ExtArgs>>): Prisma.Prisma__ClientClient<runtime.Types.Result.GetResult<Prisma.$ClientPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    findFirst<T extends ClientFindFirstArgs>(args?: Prisma.SelectSubset<T, ClientFindFirstArgs<ExtArgs>>): Prisma.Prisma__ClientClient<runtime.Types.Result.GetResult<Prisma.$ClientPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>;
    findFirstOrThrow<T extends ClientFindFirstOrThrowArgs>(args?: Prisma.SelectSubset<T, ClientFindFirstOrThrowArgs<ExtArgs>>): Prisma.Prisma__ClientClient<runtime.Types.Result.GetResult<Prisma.$ClientPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    findMany<T extends ClientFindManyArgs>(args?: Prisma.SelectSubset<T, ClientFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<runtime.Types.Result.GetResult<Prisma.$ClientPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>;
    create<T extends ClientCreateArgs>(args: Prisma.SelectSubset<T, ClientCreateArgs<ExtArgs>>): Prisma.Prisma__ClientClient<runtime.Types.Result.GetResult<Prisma.$ClientPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    createMany<T extends ClientCreateManyArgs>(args?: Prisma.SelectSubset<T, ClientCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<Prisma.BatchPayload>;
    delete<T extends ClientDeleteArgs>(args: Prisma.SelectSubset<T, ClientDeleteArgs<ExtArgs>>): Prisma.Prisma__ClientClient<runtime.Types.Result.GetResult<Prisma.$ClientPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    update<T extends ClientUpdateArgs>(args: Prisma.SelectSubset<T, ClientUpdateArgs<ExtArgs>>): Prisma.Prisma__ClientClient<runtime.Types.Result.GetResult<Prisma.$ClientPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    deleteMany<T extends ClientDeleteManyArgs>(args?: Prisma.SelectSubset<T, ClientDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<Prisma.BatchPayload>;
    updateMany<T extends ClientUpdateManyArgs>(args: Prisma.SelectSubset<T, ClientUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<Prisma.BatchPayload>;
    upsert<T extends ClientUpsertArgs>(args: Prisma.SelectSubset<T, ClientUpsertArgs<ExtArgs>>): Prisma.Prisma__ClientClient<runtime.Types.Result.GetResult<Prisma.$ClientPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    count<T extends ClientCountArgs>(args?: Prisma.Subset<T, ClientCountArgs>): Prisma.PrismaPromise<T extends runtime.Types.Utils.Record<'select', any> ? T['select'] extends true ? number : Prisma.GetScalarType<T['select'], ClientCountAggregateOutputType> : number>;
    aggregate<T extends ClientAggregateArgs>(args: Prisma.Subset<T, ClientAggregateArgs>): Prisma.PrismaPromise<GetClientAggregateType<T>>;
    groupBy<T extends ClientGroupByArgs, HasSelectOrTake extends Prisma.Or<Prisma.Extends<'skip', Prisma.Keys<T>>, Prisma.Extends<'take', Prisma.Keys<T>>>, OrderByArg extends Prisma.True extends HasSelectOrTake ? {
        orderBy: ClientGroupByArgs['orderBy'];
    } : {
        orderBy?: ClientGroupByArgs['orderBy'];
    }, OrderFields extends Prisma.ExcludeUnderscoreKeys<Prisma.Keys<Prisma.MaybeTupleToUnion<T['orderBy']>>>, ByFields extends Prisma.MaybeTupleToUnion<T['by']>, ByValid extends Prisma.Has<ByFields, OrderFields>, HavingFields extends Prisma.GetHavingFields<T['having']>, HavingValid extends Prisma.Has<ByFields, HavingFields>, ByEmpty extends T['by'] extends never[] ? Prisma.True : Prisma.False, InputErrors extends ByEmpty extends Prisma.True ? `Error: "by" must not be empty.` : HavingValid extends Prisma.False ? {
        [P in HavingFields]: P extends ByFields ? never : P extends string ? `Error: Field "${P}" used in "having" needs to be provided in "by".` : [
            Error,
            'Field ',
            P,
            ` in "having" needs to be provided in "by"`
        ];
    }[HavingFields] : 'take' extends Prisma.Keys<T> ? 'orderBy' extends Prisma.Keys<T> ? ByValid extends Prisma.True ? {} : {
        [P in OrderFields]: P extends ByFields ? never : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`;
    }[OrderFields] : 'Error: If you provide "take", you also need to provide "orderBy"' : 'skip' extends Prisma.Keys<T> ? 'orderBy' extends Prisma.Keys<T> ? ByValid extends Prisma.True ? {} : {
        [P in OrderFields]: P extends ByFields ? never : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`;
    }[OrderFields] : 'Error: If you provide "skip", you also need to provide "orderBy"' : ByValid extends Prisma.True ? {} : {
        [P in OrderFields]: P extends ByFields ? never : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`;
    }[OrderFields]>(args: Prisma.SubsetIntersection<T, ClientGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetClientGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>;
    readonly fields: ClientFieldRefs;
}
export interface Prisma__ClientClient<T, Null = never, ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise";
    assignments<T extends Prisma.Client$assignmentsArgs<ExtArgs> = {}>(args?: Prisma.Subset<T, Prisma.Client$assignmentsArgs<ExtArgs>>): Prisma.PrismaPromise<runtime.Types.Result.GetResult<Prisma.$AssignmentPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>;
    tasks<T extends Prisma.Client$tasksArgs<ExtArgs> = {}>(args?: Prisma.Subset<T, Prisma.Client$tasksArgs<ExtArgs>>): Prisma.PrismaPromise<runtime.Types.Result.GetResult<Prisma.$TaskPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>;
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): runtime.Types.Utils.JsPromise<TResult1 | TResult2>;
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): runtime.Types.Utils.JsPromise<T | TResult>;
    finally(onfinally?: (() => void) | undefined | null): runtime.Types.Utils.JsPromise<T>;
}
export interface ClientFieldRefs {
    readonly id: Prisma.FieldRef<"Client", 'Int'>;
    readonly businessName: Prisma.FieldRef<"Client", 'String'>;
    readonly contactName: Prisma.FieldRef<"Client", 'String'>;
    readonly email: Prisma.FieldRef<"Client", 'String'>;
    readonly phone: Prisma.FieldRef<"Client", 'String'>;
    readonly industry: Prisma.FieldRef<"Client", 'String'>;
    readonly createdAt: Prisma.FieldRef<"Client", 'DateTime'>;
    readonly updatedAt: Prisma.FieldRef<"Client", 'DateTime'>;
}
export type ClientFindUniqueArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.ClientSelect<ExtArgs> | null;
    omit?: Prisma.ClientOmit<ExtArgs> | null;
    include?: Prisma.ClientInclude<ExtArgs> | null;
    where: Prisma.ClientWhereUniqueInput;
};
export type ClientFindUniqueOrThrowArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.ClientSelect<ExtArgs> | null;
    omit?: Prisma.ClientOmit<ExtArgs> | null;
    include?: Prisma.ClientInclude<ExtArgs> | null;
    where: Prisma.ClientWhereUniqueInput;
};
export type ClientFindFirstArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.ClientSelect<ExtArgs> | null;
    omit?: Prisma.ClientOmit<ExtArgs> | null;
    include?: Prisma.ClientInclude<ExtArgs> | null;
    where?: Prisma.ClientWhereInput;
    orderBy?: Prisma.ClientOrderByWithRelationInput | Prisma.ClientOrderByWithRelationInput[];
    cursor?: Prisma.ClientWhereUniqueInput;
    take?: number;
    skip?: number;
    distinct?: Prisma.ClientScalarFieldEnum | Prisma.ClientScalarFieldEnum[];
};
export type ClientFindFirstOrThrowArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.ClientSelect<ExtArgs> | null;
    omit?: Prisma.ClientOmit<ExtArgs> | null;
    include?: Prisma.ClientInclude<ExtArgs> | null;
    where?: Prisma.ClientWhereInput;
    orderBy?: Prisma.ClientOrderByWithRelationInput | Prisma.ClientOrderByWithRelationInput[];
    cursor?: Prisma.ClientWhereUniqueInput;
    take?: number;
    skip?: number;
    distinct?: Prisma.ClientScalarFieldEnum | Prisma.ClientScalarFieldEnum[];
};
export type ClientFindManyArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.ClientSelect<ExtArgs> | null;
    omit?: Prisma.ClientOmit<ExtArgs> | null;
    include?: Prisma.ClientInclude<ExtArgs> | null;
    where?: Prisma.ClientWhereInput;
    orderBy?: Prisma.ClientOrderByWithRelationInput | Prisma.ClientOrderByWithRelationInput[];
    cursor?: Prisma.ClientWhereUniqueInput;
    take?: number;
    skip?: number;
    distinct?: Prisma.ClientScalarFieldEnum | Prisma.ClientScalarFieldEnum[];
};
export type ClientCreateArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.ClientSelect<ExtArgs> | null;
    omit?: Prisma.ClientOmit<ExtArgs> | null;
    include?: Prisma.ClientInclude<ExtArgs> | null;
    data: Prisma.XOR<Prisma.ClientCreateInput, Prisma.ClientUncheckedCreateInput>;
};
export type ClientCreateManyArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    data: Prisma.ClientCreateManyInput | Prisma.ClientCreateManyInput[];
    skipDuplicates?: boolean;
};
export type ClientUpdateArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.ClientSelect<ExtArgs> | null;
    omit?: Prisma.ClientOmit<ExtArgs> | null;
    include?: Prisma.ClientInclude<ExtArgs> | null;
    data: Prisma.XOR<Prisma.ClientUpdateInput, Prisma.ClientUncheckedUpdateInput>;
    where: Prisma.ClientWhereUniqueInput;
};
export type ClientUpdateManyArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    data: Prisma.XOR<Prisma.ClientUpdateManyMutationInput, Prisma.ClientUncheckedUpdateManyInput>;
    where?: Prisma.ClientWhereInput;
    limit?: number;
};
export type ClientUpsertArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.ClientSelect<ExtArgs> | null;
    omit?: Prisma.ClientOmit<ExtArgs> | null;
    include?: Prisma.ClientInclude<ExtArgs> | null;
    where: Prisma.ClientWhereUniqueInput;
    create: Prisma.XOR<Prisma.ClientCreateInput, Prisma.ClientUncheckedCreateInput>;
    update: Prisma.XOR<Prisma.ClientUpdateInput, Prisma.ClientUncheckedUpdateInput>;
};
export type ClientDeleteArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.ClientSelect<ExtArgs> | null;
    omit?: Prisma.ClientOmit<ExtArgs> | null;
    include?: Prisma.ClientInclude<ExtArgs> | null;
    where: Prisma.ClientWhereUniqueInput;
};
export type ClientDeleteManyArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    where?: Prisma.ClientWhereInput;
    limit?: number;
};
export type Client$assignmentsArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.AssignmentSelect<ExtArgs> | null;
    omit?: Prisma.AssignmentOmit<ExtArgs> | null;
    include?: Prisma.AssignmentInclude<ExtArgs> | null;
    where?: Prisma.AssignmentWhereInput;
    orderBy?: Prisma.AssignmentOrderByWithRelationInput | Prisma.AssignmentOrderByWithRelationInput[];
    cursor?: Prisma.AssignmentWhereUniqueInput;
    take?: number;
    skip?: number;
    distinct?: Prisma.AssignmentScalarFieldEnum | Prisma.AssignmentScalarFieldEnum[];
};
export type Client$tasksArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.TaskSelect<ExtArgs> | null;
    omit?: Prisma.TaskOmit<ExtArgs> | null;
    include?: Prisma.TaskInclude<ExtArgs> | null;
    where?: Prisma.TaskWhereInput;
    orderBy?: Prisma.TaskOrderByWithRelationInput | Prisma.TaskOrderByWithRelationInput[];
    cursor?: Prisma.TaskWhereUniqueInput;
    take?: number;
    skip?: number;
    distinct?: Prisma.TaskScalarFieldEnum | Prisma.TaskScalarFieldEnum[];
};
export type ClientDefaultArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.ClientSelect<ExtArgs> | null;
    omit?: Prisma.ClientOmit<ExtArgs> | null;
    include?: Prisma.ClientInclude<ExtArgs> | null;
};
