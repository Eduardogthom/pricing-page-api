import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Discount } from 'src/discount/discount.entity';
import { Repository } from 'typeorm';
import { PlanFeatures } from './plan-features/plan-features.entity';
import {
  ChangeOrderDto,
  CreateNewPricingPlanDto,
  EditNewPricingPlanDto,
} from './pricing-plan.dto';
import { PricingPlan } from './pricing-plan.entity';
import { DiscountType } from './pricing-plan.enums';

@Injectable()
export class PricingPlanService {
  constructor(
    @InjectRepository(PricingPlan)
    private pricingPlanRepository: Repository<PricingPlan>,
    @InjectRepository(PlanFeatures)
    private planFeaturesRepository: Repository<PlanFeatures>,
    @InjectRepository(Discount)
    private discountRepository: Repository<Discount>,
  ) {}

  findAll(): Promise<PricingPlan[]> {
    return this.pricingPlanRepository.find();
  }

  async createPricingPlan(body: CreateNewPricingPlanDto): Promise<PricingPlan> {
    const { name, price, planFeatures } = body;
    try {
      let discount: Discount;
      discount = await this.discountRepository.findOne({
        where: {
          discountType: DiscountType.ANNUAL,
        },
      });

      if (!discount) {
        console.log('Creating a default annual discount');
        const discountData = this.discountRepository.create({
          discountValue: 20,
          discountType: DiscountType.ANNUAL,
        });

        discount = await this.discountRepository.save(discountData);
      }

      const lastPlan = await this.pricingPlanRepository
        .createQueryBuilder('pp')
        .orderBy('planOrder', 'DESC')
        .getOne();

      const plan = this.pricingPlanRepository.create({
        name,
        price,
        planOrder: lastPlan ? lastPlan.planOrder + 1 : 1,
        discount,
      });

      const pricingPlan = await this.pricingPlanRepository.save(plan);

      for (const [index, feature] of planFeatures.entries()) {
        await this.planFeaturesRepository.save({
          pricingPlan,
          feature,
          featureOrder: index + 1,
        });
      }
      const planWithFeatures = await this.pricingPlanRepository.findOne({
        where: { id: pricingPlan.id },
        relations: ['features', 'discount'],
      });

      return planWithFeatures;
    } catch (error) {
      console.log(error);
    }
  }

  async deletePlan(planId: number): Promise<string> {
    const pricingPlan = await this.pricingPlanRepository.findOne({
      where: { id: planId },
    });

    if (!pricingPlan) {
      throw new NotFoundException(
        `There is no Pricing Plan with the id: ${planId} in the database`,
      );
    }

    await this.pricingPlanRepository.delete(planId);

    const allPlans = await this.pricingPlanRepository.find({
      order: { planOrder: 'ASC' },
    });

    for (const [index, plan] of allPlans.entries()) {
      plan.planOrder = index + 1;
      await plan.save();
    }

    return `The plan: ${pricingPlan.name}, was successfully deleted`;
  }

  async editPricingPlan(
    planId: number,
    body: EditNewPricingPlanDto,
  ): Promise<PricingPlan> {
    const { name, price, planFeatures } = body;
    const pricingPlan = await this.pricingPlanRepository.findOne({
      where: { id: planId },
    });

    if (!pricingPlan) {
      throw new NotFoundException(
        `There is no Pricing Plan with the id: ${planId} in the database`,
      );
    }

    if (!Object.keys(body).length) {
      throw new BadRequestException('Nothing to edit here');
    }

    if (!name && !price && planFeatures.length === 0) {
      throw new BadRequestException('Nothing to edit here');
    }

    if (name) {
      pricingPlan.name = name;
    }

    if (price) {
      pricingPlan.price = price;
    }

    await pricingPlan.save();

    if (planFeatures.length > 0) {
      await this.planFeaturesRepository
        .createQueryBuilder('pf')
        .delete()
        .from(PlanFeatures)
        .where('pricingPlanId = :planId', { planId })
        .execute();

      for (const [index, feature] of planFeatures.entries()) {
        await this.planFeaturesRepository.save({
          pricingPlan,
          feature,
          featureOrder: index + 1,
        });
      }
    }

    const planWithFeatures = await this.pricingPlanRepository.findOne({
      where: { id: pricingPlan.id },
      relations: ['features'],
    });

    return planWithFeatures;
  }

  async getAllPlans(): Promise<PricingPlan[]> {
    const pricingPlans = await this.pricingPlanRepository.find({
      relations: ['features', 'discount'],
      order: { planOrder: 'ASC', features: { featureOrder: 'ASC' } },
    });

    if (!pricingPlans) {
      throw new NotFoundException(`There is no plans in the database`);
    }

    return pricingPlans;
  }

  async getSinglePlan(planId: number): Promise<PricingPlan> {
    const pricingPlan = await this.pricingPlanRepository.findOne({
      where: { id: planId },
      relations: ['features', 'discount'],
    });

    if (!pricingPlan) {
      throw new NotFoundException(
        `There is no Pricing Plan with the id: ${planId} in the database`,
      );
    }

    return pricingPlan;
  }

  async changePlanPosition(
    planId: number,
    data: ChangeOrderDto,
  ): Promise<PricingPlan> {
    const { newPosition } = data;

    if (newPosition < 1) {
      throw new BadRequestException(`The new position must have a valid value`);
    }

    const pricingPlans = await this.pricingPlanRepository.find({
      order: { planOrder: 'ASC' },
    });

    if (!pricingPlans) {
      throw new NotFoundException(`There is no plans in the database`);
    }

    let finalPosition = pricingPlans[pricingPlans.length - 1].planOrder;

    if (newPosition > finalPosition) {
      throw new BadRequestException(
        `The new position is higher than the last position in the database`,
      );
    }

    const editedOrderPlan = await this.pricingPlanRepository.findOne({
      where: { id: planId },
    });

    if (editedOrderPlan.planOrder === newPosition) {
      throw new BadRequestException(`The plan is already in this position`);
    }

    for (const pricingPlan of pricingPlans) {
      if (pricingPlan.planOrder === newPosition) {
        pricingPlan.planOrder = editedOrderPlan.planOrder;
        await pricingPlan.save();
      }
    }

    editedOrderPlan.planOrder = newPosition;
    await editedOrderPlan.save();

    return editedOrderPlan;
  }
}
